import { CompleteMultipartUploadCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse } from "next/server"
import { query, withConnection } from "@/lib/db"
import { decodeMetadata, isValidFileSize, isValidPart, s3, s3Bucket } from "@/lib/s3"
import { requireUser } from "@/lib/session"

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => null)
    if (!body || typeof body.fileId !== "string" || typeof body.uploadId !== "string" || !Array.isArray(body.parts) || body.parts.length === 0 || !body.parts.every(isValidPart)) {
      return NextResponse.json({ error: "fileId, uploadId, and uploaded parts are required." }, { status: 400 })
    }

    const file = await query(
      `SELECT f.id, f.workspace_id, f.name, f.storage_key, f.size_bytes, f.sha256
       FROM file_entry f JOIN workspace_member m ON m.workspace_id = f.workspace_id
       WHERE f.id = $1 AND m.user_id = $2 AND f.status = 'pending'`,
      [body.fileId, user.id],
    )
    if (!file.rows[0]) return NextResponse.json({ error: "Upload not found." }, { status: 404 })
    const record = file.rows[0]
    const parts = body.parts.map((part: { PartNumber: number; ETag: string }) => ({ PartNumber: part.PartNumber, ETag: part.ETag })).sort((a: { PartNumber: number }, b: { PartNumber: number }) => a.PartNumber - b.PartNumber)
    const completed = await s3.send(new CompleteMultipartUploadCommand({ Bucket: s3Bucket, Key: record.storage_key, UploadId: body.uploadId, MultipartUpload: { Parts: parts } }))
    if (!completed.Key) throw new Error("S3 did not return the completed object key")

    const object = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: record.storage_key }))
    const actualSize = object.ContentLength ?? 0
    const actualSha256 = decodeMetadata(object.Metadata?.sha256)
    if (!isValidFileSize(actualSize) || actualSize !== Number(record.size_bytes) || actualSha256?.toLowerCase() !== String(record.sha256).toLowerCase()) {
      return NextResponse.json({ error: "Uploaded object failed size or checksum validation." }, { status: 422 })
    }

    await withConnection(async (client) => {
      await client.query("BEGIN")
      try {
        await client.query(`UPDATE file_entry SET status = 'ready', updated_at = now() WHERE id = $1`, [record.id])
        await client.query(`INSERT INTO file_version (id, file_id, revision, storage_key, size_bytes, sha256, created_by) VALUES (gen_random_uuid()::text, $1, 1, $2, $3, $4, $5)`, [record.id, record.storage_key, actualSize, actualSha256, user.id])
        await client.query(`UPDATE workspace SET used_bytes = used_bytes + $1 WHERE id = $2`, [actualSize, record.workspace_id])
        await client.query(`INSERT INTO sync_event (workspace_id, file_id, operation, revision, payload, created_by) VALUES ($1, $2, 'created', 1, $3::jsonb, $4)`, [record.workspace_id, record.id, JSON.stringify({ name: record.name, size: actualSize }), user.id])
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    })
    return NextResponse.json({ fileId: record.id, status: "ready", key: record.storage_key })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Upload completion failed", error)
    return NextResponse.json({ error: "Unable to complete upload." }, { status: 500 })
  }
}
