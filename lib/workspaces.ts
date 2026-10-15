import { query } from "@/lib/db"
import { randomUUID } from "node:crypto"

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer"

export async function getWorkspaceForUser(userId: string, workspaceId?: string) {
  const result = await query(
    `SELECT w.id, w.name, w.owner_id, w.quota_bytes, w.used_bytes, m.role
     FROM workspace w JOIN workspace_member m ON m.workspace_id = w.id
     WHERE m.user_id = $1 AND ($2::text IS NULL OR w.id = $2)
     ORDER BY w.created_at ASC LIMIT 1`,
    [userId, workspaceId ?? null],
  )
  return result.rows[0] ?? null
}

export function canWrite(role: WorkspaceRole) {
  return role === "owner" || role === "admin" || role === "member"
}

export function canAdmin(role: WorkspaceRole) {
  return role === "owner" || role === "admin"
}

export function parseRole(value: unknown): WorkspaceRole {
  if (value === "owner" || value === "admin" || value === "member" || value === "viewer") return value
  return "viewer"
}

export function workspaceIdFromName(_name: string) {
  return `ws_${randomUUID()}`
}

export function cleanWorkspaceName(value: unknown) {
  if (typeof value !== "string") return null
  const name = value.trim().replace(/\s+/g, " ")
  return name.length >= 2 && name.length <= 80 ? name : null
}

export function apiError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

export async function ensurePrimaryWorkspace(userId: string, userName: string) {
  const existing = await getWorkspaceForUser(userId)
  if (existing) return existing
  const workspaceId = `ws_${crypto.randomUUID()}`
  const result = await query(
    `WITH created AS (
       INSERT INTO workspace (id, name, owner_id) VALUES ($1, $2, $3) RETURNING *
     ), membership AS (
       INSERT INTO workspace_member (workspace_id, user_id, role) SELECT id, $3, 'owner' FROM created
     ) SELECT id, name, owner_id, quota_bytes, used_bytes, 'owner'::text AS role FROM created`,
    [workspaceId, `${userName || "Personal"} workspace`, userId],
  )
  return result.rows[0] ?? null
}
