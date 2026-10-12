"""Consistent error shape: machine-readable code, human message, correlation id, field errors (E3)."""

from contextvars import ContextVar

correlation_id_var: ContextVar[str | None] = ContextVar("correlation_id", default=None)


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, code: str | None = None, errors: dict[str, list[str]] | None = None,
                 status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.errors = errors or {}

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "correlationId": correlation_id_var.get(),
            "errors": self.errors,
        }


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "integration_unavailable"


def field_error(field: str, message: str, code: str = "validation_failed") -> ValidationFailed:
    return ValidationFailed(message, code=code, errors={field: [message]})
