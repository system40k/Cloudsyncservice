BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE session ADD COLUMN IF NOT EXISTS "ipAddress" text;
ALTER TABLE session ADD COLUMN IF NOT EXISTS "userAgent" text;

CREATE TABLE IF NOT EXISTS workspace_invitation (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by text NOT NULL REFERENCES "user"(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, name)
);

CREATE TABLE IF NOT EXISTS idempotency_key (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, workspace_id, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_conflict (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_id text NOT NULL REFERENCES file_entry(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  base_revision bigint NOT NULL,
  incoming_revision bigint NOT NULL,
  conflict_file_id text REFERENCES file_entry(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'discarded')),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE workspace_member ADD CONSTRAINT workspace_member_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE workspace ADD CONSTRAINT workspace_owner_fk FOREIGN KEY (owner_id) REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE folder ADD CONSTRAINT folder_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;
ALTER TABLE file_entry ADD CONSTRAINT file_entry_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;
ALTER TABLE file_entry ADD CONSTRAINT file_entry_folder_fk FOREIGN KEY (folder_id) REFERENCES folder(id) ON DELETE SET NULL;
ALTER TABLE file_entry ADD CONSTRAINT file_entry_creator_fk FOREIGN KEY (created_by) REFERENCES "user"(id);
ALTER TABLE file_version ADD CONSTRAINT file_version_file_fk FOREIGN KEY (file_id) REFERENCES file_entry(id) ON DELETE CASCADE;
ALTER TABLE file_version ADD CONSTRAINT file_version_creator_fk FOREIGN KEY (created_by) REFERENCES "user"(id);
ALTER TABLE sync_event ADD CONSTRAINT sync_event_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;
ALTER TABLE sync_event ADD CONSTRAINT sync_event_creator_fk FOREIGN KEY (created_by) REFERENCES "user"(id);

CREATE INDEX IF NOT EXISTS workspace_member_user_idx ON workspace_member (user_id, created_at);
CREATE INDEX IF NOT EXISTS invitation_workspace_email_idx ON workspace_invitation (workspace_id, lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS device_workspace_user_idx ON device (workspace_id, user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_key (expires_at);
CREATE INDEX IF NOT EXISTS audit_workspace_time_idx ON audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conflict_file_status_idx ON file_conflict (file_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_event_workspace_id_idx ON sync_event (workspace_id, id);

COMMIT;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS user_set_updated_at ON "user";
CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS session_set_updated_at ON session;
CREATE TRIGGER session_set_updated_at BEFORE UPDATE ON session FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS file_entry_set_updated_at ON file_entry;
CREATE TRIGGER file_entry_set_updated_at BEFORE UPDATE ON file_entry FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS workspace_set_updated_at ON workspace;
CREATE TRIGGER workspace_set_updated_at BEFORE UPDATE ON workspace FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS device_set_updated_at ON device;
CREATE TRIGGER device_set_updated_at BEFORE UPDATE ON device FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE device ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
