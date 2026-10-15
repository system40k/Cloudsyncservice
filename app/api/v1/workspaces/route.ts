import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { cleanWorkspaceName, ensurePrimaryWorkspace, apiError } from "@/lib/workspaces"
import { requireUser } from "@/lib/session"

export async function GET() {
  try {
    const user = await requireUser()
    const workspace = await ensurePrimaryWorkspace(user.id, user.name)
    return NextResponse.json({ workspace })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return apiError("Unauthorized", 401)
    console.error("[v0] Workspace lookup failed", error)
    return apiError("Unable to load workspace.", 500)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => null)
    const name = cleanWorkspaceName(body?.name)
    if (!name) return apiError("Workspace name must be 2–80 characters.", 400)
    const workspaceId = `ws_${crypto.randomUUID()}`
    const result = await query(
      `WITH created AS (
         INSERT INTO workspace (id, name, owner_id) VALUES ($1, $2, $3) RETURNING id, name, owner_id, quota_bytes, used_bytes, created_at
       ), membership AS (
         INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $3, 'owner')
       ) SELECT * FROM created`,
      [workspaceId, name, user.id],
    )
    return NextResponse.json({ workspace: result.rows[0] }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return apiError("Unauthorized", 401)
    console.error("[v0] Workspace creation failed", error)
    return apiError("Unable to create workspace.", 500)
  }
}
