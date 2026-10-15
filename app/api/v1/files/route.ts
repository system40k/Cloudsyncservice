import { NextResponse } from "next/server"

const files = [
  { id: "design-assets", name: "design-assets.zip", size: 248000000, created_at: "2026-10-15T09:12:00.000Z" },
  { id: "product-roadmap", name: "product-roadmap.pdf", size: 8400000, created_at: "2026-10-15T08:56:00.000Z" },
]

export async function GET() {
  return NextResponse.json({ files })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.name || typeof body.name !== "string") return NextResponse.json({ error: "A file name is required." }, { status: 400 })
  return NextResponse.json({ file: { id: crypto.randomUUID(), name: body.name, size: 0, created_at: new Date().toISOString() } }, { status: 201 })
}
