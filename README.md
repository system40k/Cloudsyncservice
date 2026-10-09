# CloudSync local file prototype

A small, single-user file storage prototype with a browser UI and a Python standard-library API. It supports uploading, listing, and downloading files on the same machine. It is **not** a multi-device synchronization service or a production cloud service.

An AWS infrastructure foundation is documented in [`infra/aws/README.md`](infra/aws/README.md), and the target sync/cache safety model is in [`docs/production-architecture.md`](docs/production-architecture.md). Those files are planning and reviewable Terraform only: they do not deploy an API or connect the local prototype to AWS.

## Requirements

- Python 3.10 or newer
- No third-party packages

## Run locally

From the repository directory:

```sh
python3 server.py
```

The server listens only on `127.0.0.1:8000`. Keep the terminal open, then visit <http://127.0.0.1:8000/>. Paste the one-time bearer token printed in the terminal into the page. Stop the process with Ctrl+C. Set `PORT` to use another local port.

The UI is an installable PWA on supported browsers (use its install button or the browser menu). Its service worker caches only public app-shell pages/icons; API responses and file contents are never cached. Installation does not request device permissions. The file picker accesses only files you explicitly select.

Uploaded file data and SQLite metadata are stored in `~/.local/share/cloudsync-local/`, outside the public site directory. `CLOUDSYNC_DATA_DIR` can select another local data directory; it must remain outside this project.

## API

- `GET /api/v1/status` — status; no token required.
- `GET /api/v1/files` — list files; bearer token required.
- `POST /api/v1/files` — upload a JSON/base64 file; bearer token required.
- `GET /api/v1/files/{id}/download` — download a file; bearer token required.

Uploads are limited to 5 MiB. The token changes whenever the server restarts. The API rejects non-local hostnames and cross-origin requests. The `api/v1/*.json` files in the repository are static examples; the running API uses the routes above.

## Limitations and security

This is a development prototype, not a hardened service. It has no user accounts, multi-device synchronization, delete endpoint, backups, encryption-at-rest management, rate limiting, or production deployment configuration. The token is shown in the terminal and intended only for local use. Do not expose the server to a network or upload sensitive files.
