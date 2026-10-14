# CloudSync production API foundation

This package is a separate production-oriented API foundation. It does not replace or modify the root-level localhost prototype in `server.py`. Cloud file upload/download routes and AWS integrations are intentionally not implemented in this first change.

## Requirements

- Python 3.11+
- PostgreSQL 14+
- A Cognito user pool configured for OAuth authorization-code flow and PKCE
- HTTPS for any deployed environment

## Local setup

From this directory:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
export CLOUDSYNC_DATABASE_URL='postgresql+psycopg://cloudsync:cloudsync@localhost:5432/cloudsync'
export CLOUDSYNC_APP_SECRET='replace-with-a-random-secret-of-at-least-24-characters'
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8001
pytest
```

The database must exist and be reachable before applying migrations. The migration command changes that database; use only a disposable local development database until reviewed.

## Required environment settings

- `CLOUDSYNC_DATABASE_URL`: PostgreSQL SQLAlchemy URL.
- `CLOUDSYNC_APP_SECRET`: random secret used to sign short-lived OAuth state. Store production values in a managed secret store.
- `CLOUDSYNC_COGNITO_ISSUER`: exact Cognito issuer URL.
- `CLOUDSYNC_COGNITO_CLIENT_ID`: Cognito public client ID.
- `CLOUDSYNC_COGNITO_AUTHORIZE_URL`, `CLOUDSYNC_COGNITO_TOKEN_URL`, `CLOUDSYNC_COGNITO_LOGOUT_URL`: endpoints for the configured user pool.
- `CLOUDSYNC_APP_BASE_URL`: public app origin; must be HTTPS in production and its callback URL must match Cognito exactly.
- `CLOUDSYNC_SESSION_COOKIE_SECURE=true`: mandatory in production.
- `CLOUDSYNC_ALLOWED_WEB_ORIGINS`: exact origins allowed to issue logout requests; configure as a JSON array, for example `["https://app.example.com"]`.
- `CLOUDSYNC_MAX_FILE_BYTES`: defaults to 104857600 (100 MiB).

The OAuth callback is `/auth/callback`. Configure this exact URI in Cognito. The current callback uses a confidential-client secret if supplied; keep it in a secret manager. If using a public Cognito client, leave the secret unset.

## Current endpoints

- `GET /health/live`: process liveness only.
- `GET /health/ready`: checks database connectivity.
- `GET /auth/login`: starts OAuth authorization-code + PKCE.
- `GET /auth/callback`: validates signed OAuth state, exchanges the code, validates the Cognito ID token, and creates a server-side session.
- `GET /auth/me`: current user summary.
- `POST /auth/logout`: invalidates the server-side session and redirects through Cognito logout.

Session cookies are HttpOnly and SameSite=Lax. Production must use HTTPS and Secure cookies. The raw session token is never stored in PostgreSQL; only its SHA-256 hash is stored. No access or ID token is returned to browser JavaScript.

## Important scope and launch blockers

This is a foundation, not a launch-ready service. It has not been deployed or connected to a live Cognito pool. Before production use, review and test OAuth settings against a real non-production pool; add CSRF protection for all future state-changing cookie-authenticated routes; add session rotation/revocation and account recovery policies; implement file authorization and S3 upload finalization with server-side size/checksum verification; add rate limits, quotas, malware scanning, structured redacted audit logs, and operational alarms. Do not use production data until security review and integration testing pass.
