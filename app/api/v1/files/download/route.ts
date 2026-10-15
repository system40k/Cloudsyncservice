import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { s3, s3Bucket } from "@/lib/s3"
import { requireUser } from "@/lib/session"

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const fileId = new URL(request.url).searchParams.get("fileId")
    if (!fileId) return NextResponse.json({ error: "fileId is required." }, { status: 400 })
    const result = await query(
      `SELECT f.id, f.name, f.storage_key, f.size_bytes, f.sha256, f.updated_at
       FROM file_entry f JOIN workspace_member m ON m.workspace_id = f.workspace_id
       WHERE f.id = $1 AND m.user_id = $2 AND f.status = 'ready'`,
      [fileId, user.id],
    )
    const file = result.rows[0]
    if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 })
    const head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: file.storage_key }))
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: file.storage_key, ResponseContentDisposition: `attachment; filename="${String(file.name).replace(/[^a-zA-Z0-9._-]/g, "-")}"` }), { expiresIn: 300 })
    return NextResponse.json({ fileId: file.id, name: file.name, size: head.ContentLength ?? file.size_bytes, sha256: file.sha256, url, expiresIn: 300 })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Download signing failed", error)
    return NextResponse.json({ error: "Unable to create download link." }, { status: 500 })
  }
}
