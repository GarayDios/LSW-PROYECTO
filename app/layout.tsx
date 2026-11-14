import type { Metadata } from "next";
import "./globals.css";
import PwaRegister from "../src/components/pwa/pwa-register";

export const metadata: Metadata = {
  title: "TEPIC · Options Lab",
  description: "Terminal de análisis cuantitativo de opciones. Explora F0, compara empresas y revisa operaciones F5 con contratos de Alpaca Paper.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TEPIC", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}<PwaRegister /></body>
    </html>
  );
}
