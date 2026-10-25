CREATE TABLE IF NOT EXISTS file_objects (
    id uuid PRIMARY KEY,
    owner_subject text NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
    object_key text NOT NULL UNIQUE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS file_objects_owner_updated_idx
    ON file_objects (owner_subject, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_subject text NOT NULL,
    action text NOT NULL,
    resource_id uuid,
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_owner_created_idx
    ON audit_events (owner_subject, created_at DESC);
