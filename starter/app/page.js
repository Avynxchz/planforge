import Link from "next/link";
export default function Home() {
  return (
    <main>
      <h1>PlanForge Starter</h1>
      <p>Fondasi Next.js fullstack: auth session, PostgreSQL, Docker, dan test sudah siap. Tambahkan fitur di atasnya, jangan bangun ulang fondasi.</p>
      <p><Link href="/login">Masuk</Link> · <Link href="/dashboard">Dashboard</Link></p>
    </main>
  );
}