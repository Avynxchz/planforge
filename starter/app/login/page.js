"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  async function submit(e) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const j = await r.json();
    if (!r.ok) { setErr((j.errors || [j.error || "gagal masuk"]).join(", ")); return; }
    router.push("/dashboard");
  }
  return (
    <main>
      <h1>Masuk</h1>
      <form onSubmit={submit} className="card">
        <p><input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required /></p>
        <p><input type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} required /></p>
        {err && <p className="err">{err}</p>}
        <button type="submit">Masuk</button>
      </form>
    </main>
  );
}