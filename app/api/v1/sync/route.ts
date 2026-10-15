import { NextResponse } from "next/server"
import { query, withConnection } from "@/lib/db"
import { requireUser } from "@/lib/session"

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    const cursor = Number(url.searchParams.get("cursor") ?? 0)
    if (!workspaceId || !Number.isSafeInteger(cursor) || cursor < 0) return NextResponse.json({ error: "workspaceId and cursor are required." }, { status: 400 })
    const membership = await query("SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2", [workspaceId, user.id])
    if (!membership.rows[0]) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 })
    const events = await query(
      `SELECT id, file_id, operation, revision, payload, created_at FROM sync_event WHERE workspace_id = $1 AND id > $2 ORDER BY id ASC LIMIT 500`,
      [workspaceId, cursor],
    )
    return NextResponse.json({ cursor: events.rows.at(-1)?.id ?? cursor, events: events.rows, hasMore: events.rows.length === 500 })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Sync pull failed", error)
    return NextResponse.json({ error: "Unable to pull sync events." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => null)
    if (!body || typeof body.workspaceId !== "string" || typeof body.deviceId !== "string" || !Array.isArray(body.events)) return NextResponse.json({ error: "workspaceId, deviceId, and events are required." }, { status: 400 })
    if (body.events.length > 100) return NextResponse.json({ error: "At most 100 events may be pushed per request." }, { status: 413 })
    const membership = await query("SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2", [body.workspaceId, user.id])
    if (!membership.rows[0]) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 })
    const accepted = await withConnection(async (client) => {
      await client.query("BEGIN")
      try {
        const output: unknown[] = []
        for (const event of body.events) {
          if (!event || typeof event.operation !== "string" || !Number.isSafeInteger(event.revision)) throw new Error("Invalid sync event")
          const inserted = await client.query(
            `INSERT INTO sync_event (workspace_id, file_id, operation, revision, payload, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
            [body.workspaceId, typeof event.fileId === "string" ? event.fileId : null, event.operation.slice(0, 40), event.revision, JSON.stringify(event.payload ?? {}), user.id],
          )
          output.push({ id: inserted.rows[0].id, operation: event.operation, revision: event.revision })
        }
        await client.query(`INSERT INTO device_cursor (workspace_id, user_id, device_id, cursor) VALUES ($1, $2, $3, COALESCE((SELECT max(id) FROM sync_event WHERE workspace_id = $1), 0)) ON CONFLICT (workspace_id, user_id, device_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`, [body.workspaceId, user.id, body.deviceId])
        await client.query("COMMIT")
        return output
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
    return NextResponse.json({ accepted })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (error instanceof Error && error.message === "Invalid sync event") return NextResponse.json({ error: error.message }, { status: 400 })
    console.error("[v0] Sync push failed", error)
    return NextResponse.json({ error: "Unable to push sync events." }, { status: 500 })
  }
}
