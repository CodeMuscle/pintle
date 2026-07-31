import type { Metadata } from "next";

import Hero from "@/components/lp/hero";
import HeroPipeline from "@/components/lp/hero-pipeline";
import LPNavbar from "@/components/lp/lp-navbar";

export const metadata: Metadata = {
  title: "Pintle — Migrate like you deploy",
  description:
    "Rehearse, cut over, and roll back customer-data migrations — verifiably, reversibly, on your own infra.",
};
export default function LandingPage() {
  const currentYear: number = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <LPNavbar />
      <Hero />
      <HeroPipeline />

      {/* ── TODO─────────────────────────────────────
          3. The wedge — "Flatfile gets data in. Rocketlane runs the project.
             Nobody moves it safely." Three-column contrast.
          4. How it works (id="how") — the 5-stage pipeline; scroll-linked
             highlight via IntersectionObserver.
          5. Feature bento — rehearse / reconcile / rollback / recipes / self-host.
          6. Self-host + security band.
          7. CTA + footer.
          See docs/design/lp-build-spec.md for the extracted DNA + per-section hints. */}

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        © Pintle {currentYear}. All rights reserved.
      </footer>
    </main>
  );
}
