import { redirect } from "next/navigation";
import { currentUser } from "../../lib/session";
import { query } from "../../lib/db";
export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const items = (await query("SELECT id, name, qty FROM items ORDER BY created_at DESC LIMIT 50")).rows;
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Masuk sebagai <b>{user.email}</b> ({user.role}).</p>
      <form action="/api/auth/logout" method="post"><button type="submit">Keluar</button></form>
      <h2>Items</h2>
      {items.length === 0 && <p>Belum ada items. Tambah lewat POST /api/items.</p>}
      <ul>{items.map(i => <li key={i.id}>{i.name} — {i.qty}</li>)}</ul>
    </main>
  );
}