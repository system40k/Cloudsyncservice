import { attachDatabasePool } from "@vercel/functions"
import { awsCredentialsProvider } from "@vercel/functions/oidc"
import { Signer } from "@aws-sdk/rds-signer"
import { Pool, type ClientBase } from "pg"

const region = process.env.AWS_REGION
const host = process.env.PGHOST
const roleArn = process.env.AWS_ROLE_ARN
const user = process.env.PGUSER || "postgres"
const hasAuroraConfig = Boolean(region && host && roleArn)
const signer = hasAuroraConfig
  ? new Signer({
      credentials: awsCredentialsProvider({ roleArn: roleArn as string, clientConfig: { region: region as string } }),
      region: region as string,
      hostname: host as string,
      username: user,
      port: Number(process.env.PGPORT || 5432),
    })
  : null

export const pool = new Pool({
  host: host || undefined,
  database: process.env.PGDATABASE || "postgres",
  port: Number(process.env.PGPORT || 5432),
  user,
  password: signer ? () => signer.getAuthToken() : process.env.DATABASE_PASSWORD,
  ssl: hasAuroraConfig ? { rejectUnauthorized: false } : undefined,
  max: 20,
})

attachDatabasePool(pool)

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params)
}

export async function withConnection<T>(fn: (client: ClientBase) => Promise<T>) {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
