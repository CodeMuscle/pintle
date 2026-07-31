import type { Metadata } from "next";

import LPNavbar from "@/components/lp/lp-navbar";

export const metadata: Metadata = { title: "Docs — Pintle" };

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <LPNavbar />
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
        <p className="mt-4 text-muted-foreground">Coming soon.</p>
      </section>
    </main>
  );
}
