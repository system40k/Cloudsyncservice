#!/usr/bin/env python3
"""Local-only file storage prototype. Not intended for production deployment."""

from __future__ import annotations

import base64
import binascii
from contextlib import contextmanager
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("CLOUDSYNC_DATA_DIR", Path.home() / ".local" / "share" / "cloudsync-local")).expanduser().resolve()
FILES_DIR = DATA_DIR / "files"
DATABASE = DATA_DIR / "metadata.sqlite3"
MAX_FILE_BYTES = 5 * 1024 * 1024
TOKEN = secrets.token_urlsafe(32)
DB_LOCK = threading.Lock()
PUBLIC_FILES = {
    "/", "/index.html", "/about.html", "/docs.html", "/status.html",
    "/privacy.html", "/terms.html", "/contact.html", "/favicon.svg",
    "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/sw.js",
    "/app-icon-192.svg", "/app-icon-512.svg",
    "/api/v1/status.json", "/api/v1/files.json",
}


@contextmanager
def database_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_storage() -> None:
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    with database_connection() as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )


def safe_filename(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    name = PurePosixPath(value.replace("\\", "/")).name
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    if name in ("", ".", ".."):
        return None
    return name[:180]


class Handler(SimpleHTTPRequestHandler):
    server_version = "CloudSyncLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        cache_control = "no-store" if urlsplit(self.path).path.startswith("/api/") else "public, max-age=0, must-revalidate"
        self.send_header("Cache-Control", cache_control)
        super().end_headers()

    def _json(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _local_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        if host not in ("localhost", "127.0.0.1"):
            self._json(403, {"error": "This prototype accepts localhost requests only."})
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.netloc.lower() != self.headers.get("Host", "").lower():
                self._json(403, {"error": "Cross-origin requests are not allowed."})
                return False
        return True

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        valid = supplied.startswith("Bearer ") and hmac.compare_digest(supplied[7:], TOKEN)
        if not valid:
            self._json(401, {"error": "Provide the bearer token printed when the server starts."})
        return valid

    def do_GET(self) -> None:
        if not self._local_request():
            return
        path = urlsplit(self.path).path
        if path == "/api/v1/status":
            self._json(200, {"status": "ok", "service": "cloudsync-local-prototype", "version": "1.0"})
            return
        if path == "/api/v1/files":
            if not self._authorized():
                return
            with DB_LOCK, database_connection() as connection:
                rows = connection.execute(
                    "SELECT id, name, size, created_at FROM files ORDER BY created_at DESC"
                ).fetchall()
            self._json(200, {"files": [dict(row) for row in rows]})
            return
        match = re.fullmatch(r"/api/v1/files/([0-9a-f-]{36})/download", path)
        if match:
            if not self._authorized():
                return
            file_id = match.group(1)
            with DB_LOCK, database_connection() as connection:
                row = connection.execute("SELECT name FROM files WHERE id = ?", (file_id,)).fetchone()
            stored_path = FILES_DIR / f"{file_id}.blob"
            if row is None or not stored_path.is_file():
                self._json(404, {"error": "File not found."})
                return
            data = stored_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(row['name'])}")
            self.end_headers()
            self.wfile.write(data)
            return
        if path not in PUBLIC_FILES:
            self._json(404, {"error": "Not found."})
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self._local_request():
            return
        if urlsplit(self.path).path not in PUBLIC_FILES:
            self.send_error(404, "Not found.")
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if not self._local_request():
            return
        if urlsplit(self.path).path != "/api/v1/files":
            self._json(404, {"error": "Not found."})
            return
        if not self._authorized():
            return
        if self.headers.get_content_type() != "application/json":
            self._json(415, {"error": "Send a JSON request body."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"error": "Invalid Content-Length."})
            return
        encoded_limit = ((MAX_FILE_BYTES + 2) // 3) * 4 + 16_384
        if content_length <= 0 or content_length > encoded_limit:
            self._json(413, {"error": "Request is empty or exceeds the 5 MiB file limit."})
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
            filename = safe_filename(payload.get("name"))
            if filename is None:
                raise ValueError("Provide a valid file name.")
            contents = base64.b64decode(payload.get("content_base64", ""), validate=True)
            if len(contents) > MAX_FILE_BYTES:
                raise OverflowError("Files must be 5 MiB or smaller.")
        except (json.JSONDecodeError, UnicodeDecodeError, binascii.Error, TypeError, AttributeError, ValueError) as error:
            self._json(400, {"error": str(error) or "Invalid JSON or file data."})
            return
        except OverflowError as error:
            self._json(413, {"error": str(error)})
            return

        file_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        stored_path = FILES_DIR / f"{file_id}.blob"
        try:
            stored_path.write_bytes(contents)
            with DB_LOCK, database_connection() as connection:
                connection.execute(
                    "INSERT INTO files (id, name, size, created_at) VALUES (?, ?, ?, ?)",
                    (file_id, filename, len(contents), created_at),
                )
        except (OSError, sqlite3.Error):
            stored_path.unlink(missing_ok=True)
            self._json(500, {"error": "Could not store the file."})
            return
        self._json(201, {"id": file_id, "name": filename, "size": len(contents), "created_at": created_at})

    def log_message(self, format: str, *args) -> None:
        # Avoid logging request headers or bearer credentials.
        super().log_message(format, *args)


def main() -> None:
    os.umask(0o077)
    if DATA_DIR == ROOT or ROOT in DATA_DIR.parents:
        raise SystemExit("CLOUDSYNC_DATA_DIR must be outside the public site directory.")
    initialize_storage()
    try:
        port = int(os.environ.get("PORT", "8000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit("PORT must be an integer between 1 and 65535.")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    print(f"CloudSync local prototype: http://127.0.0.1:{port}/")
    print(f"API bearer token (keep private): {TOKEN}")
    print(f"Files are stored locally in: {FILES_DIR}")
    print("Local prototype only — do not expose this server to a network.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local prototype.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
