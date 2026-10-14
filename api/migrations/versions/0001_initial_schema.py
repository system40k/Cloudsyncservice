"""Initial users, sessions, file metadata, upload intents, and audit tables."""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("cognito_sub", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("cognito_sub", name="uq_users_cognito_sub"))
    op.create_index("ix_users_cognito_sub", "users", ["cognito_sub"])

    op.create_table("web_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_web_sessions_token_hash"))
    for name, column in [("token_hash", "token_hash"), ("user_id", "user_id"), ("expires_at", "expires_at")]:
        op.create_index(f"ix_web_sessions_{name}", "web_sessions", [column])

    op.create_table("files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("current_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_files_owner_id", "files", ["owner_id"])

    op.create_table("file_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(1024), nullable=False),
        sa.Column("byte_length", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("file_id", "revision", name="uq_file_version_revision"),
        sa.UniqueConstraint("object_key", name="uq_file_versions_object_key"))
    op.create_index("ix_file_versions_file_id", "file_versions", ["file_id"])

    op.create_table("upload_intents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expected_bytes", sa.BigInteger(), nullable=False),
        sa.Column("expected_sha256", sa.String(64), nullable=False),
        sa.Column("object_key", sa.String(1024), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "idempotency_key", name="uq_upload_owner_idempotency"),
        sa.UniqueConstraint("object_key", name="uq_upload_intents_object_key"))
    op.create_index("ix_upload_intents_owner_id", "upload_intents", ["owner_id"])
    op.create_index("ix_upload_intents_expires_at", "upload_intents", ["expires_at"])

    op.create_table("audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_id", sa.String(128), nullable=True),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("upload_intents")
    op.drop_table("file_versions")
    op.drop_table("files")
    op.drop_table("web_sessions")
    op.drop_table("users")
