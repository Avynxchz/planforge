import "./globals.css";
export const metadata = { title: "PlanForge Starter", description: "Fondasi Next.js fullstack siap pakai" };
export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}