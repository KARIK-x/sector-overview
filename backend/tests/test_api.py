from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(session):
    from app.db import Base, engine
    from app.main import app
    from app.models import IndexObservation, Sector
    from app.services import cache

    cache.clear()

    Base.metadata.create_all(bind=engine)
    # Seed a minimal but real dataset so endpoints exercise genuine calculations.
    sector = Sector(code="BANKING", name="Commercial Banks", index_code="BANKSUBIND")
    session.add(sector)
    session.commit()
    base = date(2025, 1, 1)
    for i in range(300):
        day = base + timedelta(days=i)
        session.add(
            IndexObservation(
                index_code="BANKING",
                sector_id=sector.id,
                trade_date=day,
                close=100 + i * 0.5,
                source="test",
                status="VERIFIED",
            )
        )
        session.add(
            IndexObservation(
                index_code="NEPSE",
                trade_date=day,
                close=200 + i * 0.2,
                source="test",
                status="VERIFIED",
            )
        )
    session.commit()
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_meta(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    assert "WINNING" in r.json()["quadrants"]


def test_rotation_axis_contract(client):
    r = client.get("/api/rotation?window=20")
    assert r.status_code == 200
    body = r.json()
    assert body["axes"]["x"].startswith("Absolute strength")
    assert body["quadrants"]["top_right"] == "WINNING"
    rows = {row["code"]: row for row in body["rows"]}
    assert rows["BANKING"]["absolute_strength"] is not None


def test_sector_detail(client):
    r = client.get("/api/sectors/BANKING")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert len(body["history"]) > 100


def test_unknown_sector_404(client):
    assert client.get("/api/sectors/NOPE").status_code == 404


def test_methodology(client):
    r = client.get("/api/methodology")
    assert r.status_code == 200
    assert "quadrants" in r.json()


@pytest.mark.parametrize(
    "path",
    [
        "/api/dashboard",
        "/api/heatmap",
        "/api/rotation",
        "/api/breadth",
        "/api/liquidity",
        "/api/risk",
        "/api/fundamentals",
        "/api/factors",
        "/api/research",
        "/api/data-quality",
        "/api/events",
    ],
)
def test_endpoints_return_sanitised_json(client, path):
    """Every payload must be valid JSON with no NaN/Infinity tokens."""
    r = client.get(path)
    assert r.status_code == 200
    assert "NaN" not in r.text
    assert "Infinity" not in r.text
    r.json()  # must parse


def test_factors_payload_shape(client):
    r = client.get("/api/factors")
    assert r.status_code == 200
    body = r.json()
    assert set(body["weights"]) == {
        "momentum_20",
        "relative_20",
        "momentum_accel",
        "low_volatility",
        "liquidity",
        "trend",
    }
    row = body["rows"][0]
    assert "score" in row and "contributions" in row and "coverage" in row
    # Sorted descending, allowing an unscored sector to sit last.
    scores = [r["score"] for r in body["rows"] if r["score"] is not None]
    assert scores == sorted(scores, reverse=True)


def test_research_payload_shape(client):
    r = client.get("/api/research")
    assert r.status_code == 200
    body = r.json()
    assert "transition_matrix" in body
    assert "backtest" in body
    assert body["backtest"].get("equity_curve") is not None
    assert set(body["transition_matrix"]) == {"WINNING", "ADVANCING", "LOSING", "LAGGING"}


def test_data_quality_status_reflects_completeness(client):
    body = client.get("/api/data-quality").json()
    row = body["index_coverage"][0]
    assert row["completeness"] == pytest.approx(1.0)
    assert row["status"] == "VERIFIED"


def test_serializer_scrubs_non_finite_values():
    from app.api.serialize import clean_json

    cleaned = clean_json(
        {
            "a": float("nan"),
            "b": float("inf"),
            "c": float("-inf"),
            "d": [1.0, float("nan")],
            "e": {"f": float("inf")},
            "g": 2.5,
        }
    )
    assert cleaned == {"a": None, "b": None, "c": None, "d": [1.0, None], "e": {"f": None}, "g": 2.5}
