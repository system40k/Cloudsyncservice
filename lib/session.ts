import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user
}
