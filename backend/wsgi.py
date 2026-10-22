"""WSGI entry point for hosts such as PythonAnywhere.

FastAPI is an ASGI application. This module wraps it with ``a2wsgi`` so it can
be served by a traditional WSGI host without changing the application code.
"""

from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from a2wsgi import ASGIMiddleware

from app.main import app

application = ASGIMiddleware(app)
