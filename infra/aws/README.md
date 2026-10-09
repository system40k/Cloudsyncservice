# AWS storage, identity, and CDN foundation

This Terraform stack is a **reviewable infrastructure foundation**, not a complete or production-ready sync product. It provisions Cognito, a private versioned/KMS-encrypted S3 bucket, CloudFront with trusted-key-group signed downloads, a CloudFront-scope WAF, WAF logs with signed query strings redacted, and a least-privilege IAM policy for a future application task role. It does not deploy an API, database, web client, or sync agent, and it does not modify the localhost prototype.

## Prerequisites

- Terraform 1.10+ and AWS provider 6.x
- An AWS account and credentials supplied through the AWS CLI/profile or workload identity (never commit credentials)
- An already-created, encrypted, versioned S3 bucket for Terraform state
- A real HTTPS app origin and Cognito callback/logout URLs
- A globally unique Cognito domain prefix
- An RSA-2048 key pair for CloudFront signed URLs; keep the private key outside the repository
- For custom CloudFront aliases, DNS ownership and an ACM certificate in `us-east-1`

The first infrastructure operation is not automated: bootstrap and review the state bucket separately. Copy `backend.hcl.example` to the gitignored `backend.hcl` and fill in the state bucket name. Copy `terraform.tfvars.example` to `production.tfvars` and replace all example values. The example intentionally has a nonfunctional public-key placeholder.

Generate a signing key pair in a secure location, not in this repository. Supply only the public key to Terraform. After deployment, provision the matching private key into the output Secrets Manager secret using an approved secret-handling workflow; Terraform does not contain or create the private key material.

## Review workflow

From this directory, configure the S3 backend with `terraform init -backend-config=backend.hcl`, then run `terraform fmt -check`, `terraform validate`, and `terraform plan -var-file=production.tfvars`. Inspect the plan, account, region, WAF settings, and estimated costs before any apply. This repository does not run `terraform apply` or create AWS resources.

The Cognito pool requires TOTP MFA and a 14-character password policy. The CloudFront distribution accepts only signed GET/HEAD requests; S3 blocks public access and grants object reads only to that distribution's OAC. Browser origins must be explicitly listed. The app IAM policy has no object-delete permission. The S3 bucket name includes account and region; check global S3 name availability before applying.

## Not yet implemented

A production service still needs a JWT-validating API, tenant-scoped authorization, a PostgreSQL metadata store with backups/PITR, idempotent upload-finalization jobs, malware/content scanning policy, quotas, audit events, key rotation, alarms, incident response, and real web/desktop/mobile clients. The current `server.py` uses a local prototype token and must **not** be exposed or attached to this AWS stack.

Before release, implement and test sync revisions/conflict preservation, account isolation, revocation, upload checksums, rate/quota enforcement, retention/deletion policy, backup restoration, CDN URL expiry, and disaster recovery. Require a security review and cost review; WAF, CloudFront, Cognito, KMS, logging, and S3 usage can incur charges.
