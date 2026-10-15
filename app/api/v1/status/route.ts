import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ status: "operational", service: "cloudsync", storage: "local", checkedAt: new Date().toISOString() })
}
