from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .api.serialize import clean_json
from .config import BASE_DIR, settings
from .db import SessionLocal, init_db
from .services import cache

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:  # noqa: ANN001
        return super().render(clean_json(content))


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    try:
        with SessionLocal() as session:
            def dashboard_payload():
                from .services import analytics

                return analytics.dashboard_payload(session)

            def liquidity_summary():
                from .services import analytics

                return analytics.liquidity_summary(session)

            cache.memo("dashboard", cache.DEFAULT_TTL, dashboard_payload)
            cache.memo("liquidity", cache.DEFAULT_TTL, liquidity_summary)
    except Exception:  # noqa: BLE001
        logging.exception("Startup cache warmup failed")
    yield


app = FastAPI(
    title="NEPSE Sector Intelligence",
    version="0.1.0",
    description="Independent, visualization-first quantitative sector analysis for NEPSE.",
    default_response_class=SafeJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
# JSON payloads compress by roughly 6–8×, which matters on free-tier bandwidth.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def cache_control(request, call_next):
    response = await call_next(request)
    if request.method == "GET" and request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "public, max-age=60")
    return response


app.include_router(router)


# Serve the built frontend when present (single-service deployment).
frontend_dist = BASE_DIR.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        candidate = frontend_dist / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")
