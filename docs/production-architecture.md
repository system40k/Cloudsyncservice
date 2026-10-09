# Production sync architecture (AWS target)

## Scope and status

The selected target is AWS. `infra/aws/` contains an un-deployed foundation for Cognito, private object storage, signed CloudFront delivery, and WAF. It is not connected to the existing localhost-only `server.py`; this repository does not yet contain a production API, database, or device clients. Do not expose the current prototype or describe the product as production-ready.

Proposed service layout:

- **Identity:** Amazon Cognito using OAuth authorization-code flow with PKCE and required TOTP MFA. The application API must validate issuer, audience, expiry, and scopes on every request.
- **API/control plane:** A stateless service on private ECS Fargate tasks behind an HTTPS API ingress. It owns all user/tenant authorization, quotas, metadata, sync cursors, upload intents, and short-lived download URL creation. This service is not implemented yet.
- **Metadata:** PostgreSQL in private subnets, encrypted, Multi-AZ, automated backups and point-in-time recovery. Store user/tenant ownership, logical file IDs, immutable object versions, checksums, device cursors, and audit events—not file contents. This database is not included in the current Terraform foundation.
- **File data:** Private S3 with versioning and KMS encryption. API-created presigned uploads target opaque, server-generated object keys. The server verifies size/checksum and object existence before marking an upload committed.
- **CDN:** CloudFront uses an S3 Origin Access Control and trusted public-key group. The API issues short-lived, path-scoped signed download URLs only after authorization. Signed URLs are bearer credentials; never log their query strings or persist them longer than necessary.
- **Clients:** Web first; desktop/mobile sync agents are separate deliverables and must implement the same revision protocol. No clients beyond the local prototype are implemented.

## Sync and conflict-safety invariants

1. A logical file has immutable object versions and a monotonically increasing metadata revision. Uploads use an idempotency key and conditional revision check.
2. Concurrent edits never silently use last-write-wins. Preserve both versions, surface a conflict, and require an explicit user choice or merge.
3. A device cursor advances only after committed server changes are durably recorded. Retries must be idempotent; deletions use tombstones and a documented retention window.
4. Do not treat an S3 ETag as a universal content hash. Verify an explicit SHA-256 checksum and byte length. The server—not the client—decides whether an upload is committed.
5. CDN objects use immutable versioned keys. CDN cache entries are delivery accelerators only; PostgreSQL/S3 remain authoritative.

## Storage optimization safety invariants

- Eviction is client-side cache management, not remote deletion.
- A client may evict only a clean, fully uploaded version whose server commit, revision, and SHA-256 checksum it has verified.
- Never evict dirty, conflicted, pinned/offline, partially uploaded, or sole-known copies. Download to a temporary file, verify checksum, then atomically replace the placeholder/cache entry.
- On open, fetch the exact committed revision. If unavailable or authorization has expired, report that clearly; never substitute another revision silently.

## Required production work before launch

- Implement the API, relational schema/migrations, tenant authorization, client registration, sync protocol, and conflict UI.
- Add ECS/Fargate, private networking, HTTPS ingress, RDS PostgreSQL Multi-AZ/PITR, Secrets Manager integration, queues for scanning/finalization, and least-privilege task roles.
- Define account recovery, data retention/deletion, abuse reporting, malware scanning, quotas, audit access, key rotation, CloudTrail data events, alarm routing, incident response, and restore drills.
- Build and test web, desktop, and/or mobile clients. Test interruption/retry, concurrent edits, revocation, clock skew, large-file multipart transfer, offline changes, checksum mismatch, cache eviction, and multi-device recovery.
- Perform threat modeling, dependency/container scanning, penetration testing, privacy/legal review, WAF tuning, cost modeling, and operational readiness review. Terraform apply and external AWS setup require explicit operator review.
