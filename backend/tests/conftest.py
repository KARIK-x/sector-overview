import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Isolate tests from the development database.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{ROOT / '.pytest_tmp' / 'test.db'}")
(ROOT / ".pytest_tmp").mkdir(exist_ok=True)

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.services import analytics as _analytics  # noqa: E402


@pytest.fixture()
def session():
    _analytics.clear_caches()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        yield s
    Base.metadata.drop_all(bind=engine)
    _analytics.clear_caches()
