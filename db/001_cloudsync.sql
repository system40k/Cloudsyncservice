CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false, image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL);

CREATE TABLE IF NOT EXISTS account (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS workspace (id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL, quota_bytes bigint NOT NULL DEFAULT 26843545600, used_bytes bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS workspace_member (workspace_id text NOT NULL, user_id text NOT NULL, role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, user_id));

CREATE TABLE IF NOT EXISTS folder (id text PRIMARY KEY, workspace_id text NOT NULL, parent_id text, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, parent_id, name));

CREATE TABLE IF NOT EXISTS file_entry (id text PRIMARY KEY, workspace_id text NOT NULL, folder_id text, name text NOT NULL, storage_key text, size_bytes bigint NOT NULL DEFAULT 0, sha256 text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')), revision bigint NOT NULL DEFAULT 1, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);

CREATE TABLE IF NOT EXISTS file_version (id text PRIMARY KEY, file_id text NOT NULL, revision bigint NOT NULL, storage_key text, size_bytes bigint NOT NULL, sha256 text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (file_id, revision));

CREATE TABLE IF NOT EXISTS device_cursor (workspace_id text NOT NULL, user_id text NOT NULL, device_id text NOT NULL, cursor bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, user_id, device_id));

CREATE TABLE IF NOT EXISTS sync_event (id bigserial PRIMARY KEY, workspace_id text NOT NULL, file_id text, operation text NOT NULL, revision bigint NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS file_entry_workspace_idx ON file_entry (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sync_event_workspace_idx ON sync_event (workspace_id, id);
