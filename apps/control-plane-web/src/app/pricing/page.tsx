import type { Metadata } from "next";

import LPNavbar from "@/components/lp/lp-navbar";

export const metadata: Metadata = { title: "Pricing — Pintle" };

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <LPNavbar />
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-4 text-muted-foreground">Coming soon.</p>
      </section>
    </main>
  );
}
