"""Synchronous WSGI entry point for traditional WSGI hosts.

FastAPI is an ASGI application.  PythonAnywhere serves WSGI applications, so this
module runs the ASGI app through a small request/response bridge and initialises
the database before the first request arrives.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.db import init_db
from app.main import app

# Traditional WSGI hosts do not send an ASGI lifespan startup event.
init_db()


def _scope(environ: dict) -> dict:
    headers = []
    for key, value in environ.items():
        if key.startswith("HTTP_") and key not in ("HTTP_CONTENT_TYPE", "HTTP_CONTENT_LENGTH"):
            headers.append((key[5:].lower().replace("_", "-").encode("latin-1"), value.encode("latin-1")))
    if "CONTENT_TYPE" in environ:
        headers.append((b"content-type", environ["CONTENT_TYPE"].encode("latin-1")))
    if "CONTENT_LENGTH" in environ:
        headers.append((b"content-length", environ["CONTENT_LENGTH"].encode("latin-1")))

    path = environ.get("PATH_INFO", "/")
    query = environ.get("QUERY_STRING", "")
    server_name = environ.get("SERVER_NAME", "localhost")
    server_port = int(environ.get("SERVER_PORT", "80") or 80)
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": environ.get("SERVER_PROTOCOL", "HTTP/1.1").split("/")[-1],
        "method": environ["REQUEST_METHOD"],
        "scheme": environ.get("wsgi.url_scheme", "http"),
        "path": path,
        "query_string": query.encode("ascii"),
        "root_path": environ.get("SCRIPT_NAME", ""),
        "headers": headers,
        "server": (server_name, server_port),
    }
    remote_addr = environ.get("REMOTE_ADDR")
    remote_port = environ.get("REMOTE_PORT")
    if remote_addr:
        try:
            scope["client"] = (remote_addr, int(remote_port or 0))
        except (TypeError, ValueError):
            scope["client"] = (remote_addr, 0)
    return scope


def _receive(environ: dict):
    content_length = int(environ.get("CONTENT_LENGTH") or 0)
    body = b""
    if content_length > 0:
        stream = environ.get("wsgi.input")
        if stream is not None:
            body = stream.read(content_length)
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    return receive


async def _run(scope: dict, receive) -> tuple[int, list[tuple[bytes, bytes]], list[bytes]]:
    status = 500
    headers: list[tuple[bytes, bytes]] = []
    body_parts: list[bytes] = []

    async def send(message):
        nonlocal status, headers
        if message["type"] == "http.response.start":
            status = message["status"]
            headers = list(message.get("headers", []))
        elif message["type"] == "http.response.body":
            body_parts.append(message.get("body", b""))

    await app(scope, receive, send)
    return status, headers, body_parts


def application(environ, start_response):
    scope = _scope(environ)
    receive = _receive(environ)
    try:
        status, headers, body_parts = asyncio.run(_run(scope, receive))
    except Exception as exc:  # noqa: BLE001
        status = 500
        headers = [(b"content-type", b"text/plain; charset=utf-8")]
        body_parts = [f"Internal server error: {exc}".encode()]
    status_text = f"{status} {status_text_for(status)}"
    start_response(status_text, [(k.decode("latin-1"), v.decode("latin-1")) for k, v in headers])
    return body_parts


def status_text_for(status: int) -> str:
    from http import HTTPStatus

    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Unknown Status Code"
