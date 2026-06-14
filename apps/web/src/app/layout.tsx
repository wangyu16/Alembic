import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Alembic",
  description:
    "An open educational resource ecosystem for STEM — raw course materials in, refined reusable OER out.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* KaTeX styles for rendered math in previews and pages (dev: CDN). */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css"
          integrity="sha384-n8MVd4RsNIU0tAv4ct0nTaAbDJwPJzDEaqSD1odI+WdtXRGWt2kTvGFasHpSy3SV"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
            <a href="/" className="font-semibold tracking-tight">
              Alembic
            </a>
            <div className="flex items-center gap-4 text-sm">
              <a href="/workspace" className="hover:underline">
                Workspace
              </a>
              <a href="/signin" className="hover:underline">
                Sign in
              </a>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
