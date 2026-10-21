# Deployment Guide

The application is a **single Python service** that serves both the JSON API and the built SPA.
There is no separate frontend host, no queue, no cache server and no scheduled worker inside the
request path. That shape is deliberate: it fits free tiers and keeps the moving parts countable.

```
┌──────────────────────────────────────────────┐
│  FastAPI (uvicorn)                           │
│   /api/*        read-only JSON, 90 s cache   │
│   /assets/*     hashed static files          │
│   /*            SPA fallback → index.html    │
└───────────────┬──────────────────────────────┘
                │ SQLAlchemy
        ┌───────▼────────┐
        │ SQLite file    │  default, needs a persistent disk
        │ or PostgreSQL  │  recommended for free hosts with ephemeral disks
        └────────────────┘
```

---

## 1. Local production run

```bash
# build the SPA once
cd frontend && npm ci && npm run build

# serve API + SPA
cd ../backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`app.main` mounts `frontend/dist` at import time if it exists. Build the frontend **before** starting
the server, or the root route will not be served.

Ingest once (required for any data):

```bash
backend/.venv/bin/python scripts/ingest.py all
```

Environment (`.env` in `backend/` or real environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///backend/data/sector_intelligence.db` | SQLAlchemy URL; use `postgresql+psycopg://…` for Postgres |
| `DATA_DIR` | `backend/data` | Raw cache and default SQLite location |
| `CORS_ORIGINS` | localhost dev origins | Comma-separated allowed origins; irrelevant when same-origin |
| `GITHUB_TOKEN` | empty | Optional; raises the raw.githubusercontent rate limit during ingestion |

---

## 2. Docker

The included `Dockerfile` builds the frontend in a Node stage and copies `dist` into a Python 3.12
runtime.

```bash
docker build -t nepse-sector-intelligence .
docker run --rm -p 8000:8000 \
  -v nsi-data:/data \
  nepse-sector-intelligence
```

The image expects the SQLite database at `/data/sector_intelligence.db`. A named volume keeps it
across restarts. On first run the database is **empty**; exec into the container and ingest:

```bash
docker exec -it <container> python /app/scripts/ingest.py all
```

> The Docker build itself was **not executed** in this environment (`docker` was unavailable). The
> file is written and reviewed; treat the first build as an unverified step.

For a managed Postgres, drop the volume and set `DATABASE_URL`. The container then becomes stateless
and can be replaced freely.

---

## 3. Free hosting options (researched 2026-10-22)

Free tiers change. Verify the current limits on the provider's pricing page before committing. The
constraints below are the ones that actually affect this app.

### Option A — Render Free Web Service + Neon Free Postgres (recommended)

| Constraint | Value | Consequence |
| --- | --- | --- |
| Render free web service | Spins down after ~15 min idle; 750 h/month; ~5 GB bandwidth | First request after idle takes 30–60 s |
| Render free Postgres | Expires after ~30 days | **Do not use it**; use Neon instead |
| Neon free | ~0.5–1 GB storage per project, scale-to-zero after ~5 min idle | Enough for this dataset if history is pruned; first query wakes in seconds |
| Both | No credit card required for the free tiers | $0 to run |

**Why it fits:** the API is read-only and compresses to 10–24 kB per payload; traffic is tiny and the
dataset is static between ingests. The cold start is the only user-visible cost.

**Steps**

1. **Create the database.** In Neon, create a project and copy the pooled connection string. Convert
   the scheme to SQLAlchemy's psycopg form:
   `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require`
2. **Create the service.** In Render, *New → Web Service*, connect the repository, runtime **Docker**
   (uses the included `Dockerfile`). Health check path: `/api/health`.
3. **Set environment variables** in Render:
   * `DATABASE_URL` — the Neon URL
   * `CORS_ORIGINS` — leave empty for same-origin, or your custom domain
   * Do **not** set `DATA_DIR`; no persistent disk is needed with Postgres
4. **Ingest once.** Open the Render shell and run:
   ```bash
   python /app/scripts/ingest.py all
   ```
   This downloads the public files, writes ~474 k rows and takes a few minutes. It is idempotent.
5. **Verify:** `GET /api/health` → `{"status":"ok"}` then `GET /api/data-quality` → coverage rows.
6. **Refresh** (optional, free): a GitHub Actions scheduled workflow with `DATABASE_URL` as a
   repository secret runs the same ingest weekly. Keep the workflow manual-dispatchable so it cannot
   silently fail forever.

**Sizing note:** the SQLite file is 128 MB. Postgres with indexes is larger; estimate 200–350 MB.
That fits the 0.5–1 GB free tier, but the daily-summary table is the bulk. If you need headroom,
prune `daily_summaries` to the last 5 years (breadth will still work) or keep SQLite on a host with
a disk.

### Option B — Hugging Face Docker Space

| Constraint | Value | Consequence |
| --- | --- | --- |
| Free CPU Basic | 2 vCPU, 16 GB RAM, ~50 GB non-persistent disk | Fast enough; data must be rebuildable |
| Sleep | Paused after 48 h of inactivity | Wakes on the next visit |
| Disk | **Not persistent** | A SQLite file written at runtime is lost on restart/rebuild |

**Pattern that works:** run ingestion during the image build so the database is baked into the
image, then serve read-only. Rebuild the Space to refresh data. Alternatively point
`DATABASE_URL` at Neon and keep the image stateless — simpler and recommended.

The Space needs a `README.md` with the `sdk: docker` / `app_port: 8000` front-matter at the
repository root it deploys from; do not overwrite this project's README.

### Option C — Oracle Cloud Always Free VM

| Constraint | Value | Consequence |
| --- | --- | --- |
| Always Free compute | Arm Ampere A1 (up to 4 OCPU / 24 GB, subject to capacity) + small AMD instances | Always on, no cold start |
| Block storage | ~200 GB total free | Plenty for SQLite + raw cache |
| Effort | You manage the OS, firewall, TLS and updates | Highest operational burden |

This is the best option if cold starts are unacceptable. Run the Docker image with a named volume,
put Caddy or nginx in front for TLS, and schedule `scripts/ingest.py` with cron.

### Option D — Any VPS or home server

Identical to Option C without the free-tier capacity games. A 1 GB RAM instance is sufficient:
the API is single-process and the working set is a few hundred MB with pandas loaded.

### What does **not** work alone

* **Vercel / Netlify / Cloudflare Pages / GitHub Pages:** static-only. They can host the SPA but not
  the FastAPI + pandas backend. Splitting the two is possible (static host + API elsewhere) but adds
  CORS and a second deploy for no benefit here.
* **Cloudflare Workers (Python):** the runtime is not a general CPython with pandas/scipy and a
  writable SQLite file.
* **Render's free PostgreSQL:** 30-day expiry makes it unsuitable for a long-lived demo.

### Cost summary

| Component | Free option | Monthly cost |
| --- | --- | --- |
| Web service | Render free / HF Space / Oracle VM | $0 |
| Database | Neon free / SQLite on a volume | $0 |
| Ingest schedule | GitHub Actions on a public repo | $0 |
| TLS + domain | Provider subdomain | $0 |
| **Total** | | **$0** |

No paid service is required. If you outgrow the free tier, the first upgrade is the web service
(to remove cold starts), not the database.

---

## 4. Database strategy

| Host type | Recommendation |
| --- | --- |
| Local / VPS / Docker with volume | SQLite. One file, no server, backup by copying |
| Render / HF / any ephemeral disk | **PostgreSQL** (Neon free). SQLite will silently reset |
| Read-only demo | Either; the API never writes during a request |

Switching is a single environment variable; the models use portable types and `psycopg[binary]` is
already in `requirements.txt`.

### Backups

* SQLite: stop the writer (there is none during serving), copy `sector_intelligence.db`. The raw
  cache in `data/raw/` plus `scripts/ingest.py` can reconstruct it.
* Postgres: use the provider's point-in-time restore, or `pg_dump` after ingestion.

---

## 5. Ingestion in production

Ingestion is a **batch job**, not part of the request path.

```bash
python scripts/ingest.py all             # sectors, indices, securities, summaries, fundamentals
python scripts/ingest.py indices         # one stage
python scripts/ingest.py all --no-summaries   # skip the slow per-security pass
```

Operational rules:

1. Run it from the same image and the same `DATABASE_URL` as the service.
2. It is idempotent: unique constraints on `(index_code, trade_date)` and `(symbol, trade_date)`,
   and report deduplication per symbol/fiscal period.
3. It records an `ingestion_runs` row for every stage, including failures, which the Data Quality
   Center displays.
4. Do not run two ingests concurrently against the same database.
5. After ingestion, the in-process cache is stale for at most 90 seconds. Restart the service if you
   need an immediate refresh.

---

## 6. Health, monitoring and limits

| Check | How |
| --- | --- |
| Liveness | `GET /api/health` → `{"status":"ok"}` |
| Data availability | `GET /api/data-quality` → `index_coverage`, `ingestion_runs` |
| Freshness | `latest_date` on `/api/dashboard`; the header shows the session date |
| Errors | uvicorn logs (structured level + message); provider log stream |
| Cache | in-process, 90 s TTL; no external dependency |

**Not implemented:** authentication, rate limiting, request tracing, metrics export and alerting.
The API is read-only and public by design; if you expose it at scale, put it behind a CDN or a
provider-level rate limiter. All payloads are cached for 90 s, which bounds database load.

---

## 7. Security checklist

* No secrets in the repository; `.env` is git-ignored and `.env.example` contains no credentials.
* `DATABASE_URL` is supplied by the host, never committed.
* The API exposes no user data, no writes and no file paths.
* CORS is restricted to configured origins; same-origin deployment needs none.
* The container runs as root by default (base image). For a hardened deployment add a non-root user
  and a read-only root filesystem with `/data` mounted writable.
* Source data licences are respected: the database and raw cache are git-ignored, and the
  `menaceXnadin` mirror has **no declared licence**, so do not publish a database built from it.
* Choose a licence for the code before making the repository public.

---

## 8. Deployment checklist

- [ ] Frontend built (`frontend/dist` exists) or Docker image built
- [ ] `DATABASE_URL` points at a persistent database
- [ ] `scripts/ingest.py all` completed successfully
- [ ] `ingestion_runs` shows OK for each stage
- [ ] `/api/health` returns 200
- [ ] `/api/data-quality` shows the expected latest date and no unexpected `FAILED_VALIDATION`
- [ ] Root `/` serves the SPA and deep links (e.g. `/rotation`) return `index.html`
- [ ] A hard refresh on a lazy route works (SPA fallback)
- [ ] Dark theme persists across reloads
- [ ] Cold-start behaviour is acceptable (or a paid/always-on host is chosen)
