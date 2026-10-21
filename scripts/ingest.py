from __future__ import annotations

import sys
from pathlib import Path

# Allow `python scripts/ingest.py` without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.config import settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.ingestion.pipeline import (  # noqa: E402
    ingest_all,
    ingest_daily_summaries,
    ingest_fundamentals,
    ingest_index_history,
    ingest_securities,
    upsert_sectors,
)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="NEPSE Sector Intelligence ingestion")
    parser.add_argument(
        "command",
        choices=[
            "all",
            "sectors",
            "indices",
            "securities",
            "summaries",
            "fundamentals",
            "init",
        ],
        nargs="?",
        default="all",
    )
    parser.add_argument("--no-summaries", action="store_true", help="Skip the slow stock-summary pass")
    args = parser.parse_args()

    init_db()
    with SessionLocal() as session:
        if args.command == "all":
            result = ingest_all(session, include_summaries=not args.no_summaries)
        elif args.command == "sectors":
            result = {"sectors": upsert_sectors(session)}
        elif args.command == "indices":
            result = {"index_history": ingest_index_history(session)}
        elif args.command == "securities":
            result = {"securities": ingest_securities(session)}
        elif args.command == "summaries":
            result = {"daily_summaries": ingest_daily_summaries(session)}
        elif args.command == "fundamentals":
            result = {"fundamentals": ingest_fundamentals(session)}
        else:
            result = {"init": 0}
        print(f"Database: {settings.database_url}")
        print(result)


if __name__ == "__main__":
    main()
