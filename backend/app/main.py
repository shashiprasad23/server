import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm.exc import StaleDataError

from app.config import get_settings
from app.core.errors import AppError, correlation_id_var

log = logging.getLogger("upm")


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = None
    if get_settings().run_worker_in_process:
        from app.worker import Worker

        worker = Worker()
        worker.start()
    yield
    if worker:
        worker.stop()


def create_app() -> FastAPI:
    import app.models  # noqa: F401  (register all tables)
    from app.modules.admin.router import router as admin_router
    from app.modules.agile.router import router as agile_router
    from app.modules.identity.router import router as identity_router
    from app.modules.integrations.router import router as integrations_router
    from app.modules.meetings.router import router as meetings_router
    from app.modules.notifications.router import router as notifications_router
    from app.modules.reporting.router import router as reporting_router
    from app.modules.resources.router import router as resources_router
    from app.modules.search.router import router as search_router
    from app.modules.service_desk.router import router as service_router
    from app.modules.time.router import router as time_router
    from app.modules.work.router import router as work_router

    settings = get_settings()
    if settings.environment == "production":
        # Fail fast rather than run production with development identity shortcuts.
        if settings.auth_mode != "oidc":
            raise RuntimeError("Production requires UPM_AUTH_MODE=oidc (Entra ID); dev sign-in is disabled")
        if "dev-only" in settings.jwt_secret or settings.webhook_secret == "dev-webhook-secret":
            raise RuntimeError("Production requires real UPM_JWT_SECRET and UPM_WEBHOOK_SECRET from the secrets store")
    app = FastAPI(title="Unified Enterprise Project Management Platform API", version="1.0.0",
                  openapi_url="/api/v1/openapi.json", docs_url="/api/docs", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Correlation-ID", "ETag",
                                                                                 "Idempotent-Replay"])

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        cid = request.headers.get("X-Correlation-ID") or uuid.uuid4().hex
        token = correlation_id_var.set(cid[:64])
        try:
            response = await call_next(request)
        finally:
            correlation_id_var.reset(token)
        response.headers["X-Correlation-ID"] = cid[:64]
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(exc.to_dict(), status_code=exc.status_code)

    @app.exception_handler(StaleDataError)
    async def stale(_: Request, exc: StaleDataError):
        return JSONResponse({"code": "version_conflict", "message": "This record changed while you were editing it",
                             "correlationId": correlation_id_var.get(), "errors": {}}, status_code=409)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError):
        errors: dict[str, list[str]] = {}
        for e in exc.errors():
            loc = ".".join(str(x) for x in e["loc"] if x not in ("body", "query", "path"))
            errors.setdefault(loc or "request", []).append(e["msg"])
        return JSONResponse({"code": "validation_failed", "message": "The request is not valid",
                             "correlationId": correlation_id_var.get(), "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse({"code": "internal_error", "message": "Something went wrong. Quote the correlation id "
                             "when reporting it.", "correlationId": correlation_id_var.get(), "errors": {}},
                            status_code=500)

    for r in (identity_router, work_router, time_router, agile_router, resources_router, service_router,
              meetings_router, reporting_router, notifications_router, search_router, admin_router,
              integrations_router):
        app.include_router(r, prefix="/api/v1")

    @app.get("/api/health", tags=["ops"])
    def health():
        from sqlalchemy import text

        from app.db import get_engine

        with get_engine().connect() as c:
            c.execute(text("select 1"))
        return {"status": "ok"}

    static = settings.static_dir and Path(settings.static_dir)
    if static and static.exists():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            candidate = static / path
            if path and candidate.is_file() and static in candidate.resolve().parents:
                return FileResponse(candidate)
            return FileResponse(static / "index.html")

    return app


app = create_app()
