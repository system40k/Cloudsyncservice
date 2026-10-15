"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"

export default function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)
    const result = mode === "sign-in"
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name })
    setPending(false)
    if (result.error) {
      setError("Unable to authenticate with those details.")
      return
    }
    router.push("/")
    router.refresh()
  }

  return <form className="auth-form" onSubmit={submit}>
    {mode === "sign-up" && <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
    <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
    <label>Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="upload-button full" disabled={pending}>{pending ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
  </form>
}
