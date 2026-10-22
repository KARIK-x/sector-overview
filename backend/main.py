"""Vercel ASGI entrypoint.

Vercel's Python runtime looks for a module-level ``app``. Keeping this thin
re-export lets Vercel use the ASGI application directly instead of the
synchronous PythonAnywhere WSGI bridge in ``wsgi.py``.
"""

from app.main import app

__all__ = ["app"]
