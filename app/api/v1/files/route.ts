import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireUser } from "@/lib/session"

export async function GET() {
  try {
    const user = await requireUser()
    const result = await query(
      `SELECT f.id, f.name, f.size_bytes AS size, f.sha256, f.revision, f.status, f.created_at, f.updated_at
       FROM file_entry f JOIN workspace_member m ON m.workspace_id = f.workspace_id
       WHERE m.user_id = $1 AND f.status <> 'deleted' ORDER BY f.updated_at DESC LIMIT 100`,
      [user.id],
    )
    return NextResponse.json({ files: result.rows })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Files list failed", error)
    return NextResponse.json({ error: "Unable to load files." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => null)
    if (!body || typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 255) return NextResponse.json({ error: "A valid file name is required." }, { status: 400 })
    if (!process.env.S3_BUCKET) return NextResponse.json({ error: "File storage is not configured yet. Connect private S3 before uploading." }, { status: 503 })
    return NextResponse.json({ error: "Upload intent is not available." }, { status: 501 })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Upload intent failed", error)
    return NextResponse.json({ error: "Unable to create upload intent." }, { status: 500 })
  }
}
