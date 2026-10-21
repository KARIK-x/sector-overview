# syntax=docker/dockerfile:1

# ---- Stage 1: build the static frontend -------------------------------------
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime ------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY --from=web /web/dist ./frontend/dist

# The SQLite database lives on a mounted volume in production. Without a
# volume the dataset must be re-ingested after every deploy (see DEPLOYMENT.md).
ENV DATA_DIR=/data \
    DATABASE_URL=sqlite:////data/sector_intelligence.db
VOLUME ["/data"]

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
