from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
)

if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA temp_store=MEMORY")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    from . import models  # noqa: F401  (register metadata)

    Base.metadata.create_all(bind=engine)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
