import Link from "next/link"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import AuthForm from "@/components/auth-form"

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect("/")
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">CloudSync workspace</p><h1>Welcome back</h1><p>Sign in to manage your synced files.</p><AuthForm mode="sign-in" /><p className="auth-switch">New here? <Link href="/sign-up">Create an account</Link></p></section></main>
}
