import Link from "next/link"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import AuthForm from "@/components/auth-form"

export default async function SignUpPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect("/")
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">CloudSync workspace</p><h1>Create your account</h1><p>Secure your files with a personal workspace.</p><AuthForm mode="sign-up" /><p className="auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p></section></main>
}
