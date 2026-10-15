import { S3Client } from "@aws-sdk/client-s3"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

const region = process.env.AMAZON_S3___OBJECT_STORAGE_AWS_REGION || process.env.AWS_REGION
const roleArn = process.env.AMAZON_S3___OBJECT_STORAGE_AWS_ROLE_ARN || process.env.AWS_ROLE_ARN
export const s3Bucket = process.env.AMAZON_S3___OBJECT_STORAGE_S3_BUCKET_NAME

export function getS3() {
  if (!region || !roleArn || !s3Bucket) throw new Error("Amazon S3 integration is not configured")
  return new S3Client({
    region,
    credentials: awsCredentialsProvider({ roleArn, clientConfig: { region } }),
  })
}

export const s3 = new Proxy({} as S3Client, {
  get(_target, property) {
    const client = getS3()
    const value = client[property as keyof S3Client]
    return typeof value === "function" ? value.bind(client) : value
  },
})

export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024

export function storageKey(workspaceId: string, fileId: string, name: string) {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180)
  return `workspaces/${workspaceId}/files/${fileId}/${safeName}`
}

export function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
}

export function isValidFileSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_FILE_SIZE
}

export function isValidPart(value: unknown): value is { PartNumber: number; ETag: string } {
  return Boolean(value && typeof value === "object" && Number.isInteger((value as { PartNumber?: unknown }).PartNumber) && typeof (value as { ETag?: unknown }).ETag === "string")
}

export function encodeMetadata(value: string) {
  return encodeURIComponent(value)
}

export function decodeMetadata(value: string | undefined) {
  return value ? decodeURIComponent(value) : undefined
}

export function getWorkspaceId(userId: string) {
  return `workspace-${userId}`
}

export function getUploadIdKey(uploadId: string) {
  return `cloudsync-upload-${uploadId}`
}
