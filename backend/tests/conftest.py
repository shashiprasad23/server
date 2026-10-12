"""Integration test harness.

A seeded template database is built once per session; each test gets a fresh copy via
CREATE DATABASE ... TEMPLATE (fast, fully isolated). Requires a PostgreSQL the test role can create databases on.
"""

import os
import uuid

import psycopg
import pytest

ADMIN_URL = os.environ.get("UPM_TEST_ADMIN_DSN", "postgresql://upm:upm@localhost:5432/postgres")
BASE = os.environ.get("UPM_TEST_DB_BASE", "postgresql+psycopg://upm:upm@localhost:5432/")
TEMPLATE = "upm_test_template"
TEST_DB = "upm_test"

os.environ["UPM_DATABASE_URL"] = BASE + TEST_DB
os.environ["UPM_RUN_WORKER_IN_PROCESS"] = "false"
os.environ["UPM_AUTH_MODE"] = "dev"
os.environ["UPM_STORAGE_DIR"] = "/tmp/upm-test-storage"


def _admin(sql: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(sql)


def _drop(name: str) -> None:
    _admin(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{name}' AND pid <> pg_backend_pid()")
    _admin(f'DROP DATABASE IF EXISTS "{name}"')


@pytest.fixture(scope="session", autouse=True)
def template_db():
    from app import db as dbmod

    _drop(TEST_DB)
    _drop(TEMPLATE)
    _admin(f'CREATE DATABASE "{TEMPLATE}"')
    dbmod.reset_engine(BASE + TEMPLATE)
    from app import seed

    seed.reset()
    seed.run()
    dbmod.get_engine().dispose()
    yield
    dbmod.get_engine().dispose()


@pytest.fixture()
def fresh_db(template_db):
    from app import db as dbmod

    if dbmod._engine is not None:
        dbmod._engine.dispose()
    _drop(TEST_DB)
    _admin(f'CREATE DATABASE "{TEST_DB}" TEMPLATE "{TEMPLATE}"')
    dbmod.reset_engine(BASE + TEST_DB)
    yield
    dbmod.get_engine().dispose()


@pytest.fixture()
def client(fresh_db):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def db(fresh_db):
    from app.db import session_factory

    s = session_factory()()
    yield s
    s.close()


class Api:
    """Thin client acting as one signed-in persona."""

    def __init__(self, client, email: str):
        self.c = client
        r = client.post("/api/v1/auth/dev-login", json={"email": email})
        assert r.status_code == 200, r.text
        self.h = {"Authorization": f"Bearer {r.json()['accessToken']}"}

    def get(self, path, **kw):
        return self.c.get("/api/v1" + path, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def post(self, path, json=None, **kw):
        return self.c.post("/api/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def patch(self, path, json=None, **kw):
        return self.c.patch("/api/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def put(self, path, json=None, **kw):
        return self.c.put("/api/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def log(self, key, minutes=60, work_date=None, key_=None, **extra):
        from app.core.timeutil import today_in

        body = {"workDate": str(work_date or today_in("Asia/Kolkata")), "durationMinutes": minutes,
                "activityCategory": "Development", "description": "Implemented and tested validation.", **extra}
        return self.post(f"/work-items/{key}/time-entries", json=body,
                         headers={"Idempotency-Key": key_ or uuid.uuid4().hex})


@pytest.fixture()
def as_user(client):
    cache = {}

    def make(short: str) -> Api:
        email = {"sp": "s.prasad@example.com", "ri": "r.iyer@example.com", "ko": "k.osei@example.com",
                 "ar": "a.rao@example.com", "ml": "m.lin@example.com", "ql": "l.fernandes@example.com",
                 "rm": "n.kapoor@example.com", "ex": "e.grant@example.com", "ad": "admin@example.com",
                 "tb": "t.becker@example.com", "dp": "d.patel@example.com", "ms": "m.shah@example.com"}[short]
        if short not in cache:
            cache[short] = Api(client, email)
        return cache[short]

    return make
