import { CreateMultipartUploadCommand, UploadPartCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import { getUploadIdKey, isValidFileSize, isValidSha256, MULTIPART_PART_SIZE, s3, s3Bucket, storageKey } from "@/lib/s3"
import { requireUser } from "@/lib/session"

export async function GET() {
  try {
    const user = await requireUser()
    const result = await query(
      `SELECT f.id, f.name, f.size_bytes AS size, f.sha256, f.revision, f.status, f.folder_id, f.created_at, f.updated_at
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
    if (!isValidFileSize(body.size) || !isValidSha256(body.sha256)) return NextResponse.json({ error: "A positive size and SHA-256 checksum are required." }, { status: 400 })

    const workspace = await query(
      `SELECT m.workspace_id, w.quota_bytes, w.used_bytes FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
      [user.id],
    )
    if (!workspace.rows[0]) return NextResponse.json({ error: "No workspace is available." }, { status: 403 })
    const { workspace_id: workspaceId, quota_bytes: quotaBytes, used_bytes: usedBytes } = workspace.rows[0]
    if (BigInt(usedBytes) + BigInt(body.size) > BigInt(quotaBytes)) return NextResponse.json({ error: "Workspace quota exceeded." }, { status: 413 })

    const fileId = randomUUID()
    const key = storageKey(workspaceId, fileId, body.name.trim())
    const created = await query(
      `INSERT INTO file_entry (id, workspace_id, folder_id, name, storage_key, size_bytes, sha256, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING id`,
      [fileId, workspaceId, body.folderId ?? null, body.name.trim(), key, body.size, body.sha256.toLowerCase(), user.id],
    )
    if (!created.rows[0]) return NextResponse.json({ error: "Unable to create file record." }, { status: 500 })

    const multipart = await s3.send(new CreateMultipartUploadCommand({ Bucket: s3Bucket, Key: key, Metadata: { sha256: body.sha256.toLowerCase(), fileid: fileId }, ContentType: typeof body.contentType === "string" ? body.contentType.slice(0, 180) : "application/octet-stream" }))
    if (!multipart.UploadId) throw new Error("S3 did not return an upload ID")
    const partCount = Math.ceil(body.size / MULTIPART_PART_SIZE)
    const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => ({ partNumber: index + 1, url: await getSignedUrl(s3, new UploadPartCommand({ Bucket: s3Bucket, Key: key, UploadId: multipart.UploadId, PartNumber: index + 1 }), { expiresIn: 900 }) })))
    return NextResponse.json({ fileId, uploadId: multipart.UploadId, key, partSize: MULTIPART_PART_SIZE, parts, uploadIdKey: getUploadIdKey(multipart.UploadId) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[v0] Upload intent failed", error)
    return NextResponse.json({ error: "Unable to create upload intent." }, { status: 500 })
  }
}
