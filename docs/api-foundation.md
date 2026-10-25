# API foundation

`api_service.py` is the first production control-plane slice. It provides:

- Cognito JWT validation with issuer, expiry, subject, token-use, and client checks.
- Authenticated, owner-scoped file metadata listing.
- Idempotency-key-required upload intents with SHA-256 and size validation.
- PostgreSQL metadata and audit tables in `migrations/001_initial.sql`.
- A dependency-aware health endpoint at `/api/v1/status`.

This does not yet commit S3 uploads, issue signed downloads, or implement sync cursors/conflict resolution. Those are the next API milestones. Run the service with `uvicorn api_service:app`; deploy it behind HTTPS with the task role and private database access described in `docs/production-architecture.md`.
