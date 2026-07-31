import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pintle — Migrate like you deploy",
  description:
    "Rehearse, cut over, and roll back customer-data migrations — verifiably, reversibly, on your own infra.",
};

/**
 * Landing page scaffold — YOUR playground. Public (allow-listed in proxy.ts),
 * so no auth. It reuses the @pintle/ui tokens already loaded by the root layout:
 * use `bg-background`, `text-foreground`, `text-brand`, `bg-brand`, `border-border`,
 * `text-muted-foreground`, `bg-card`, semantic `text-success/warning/destructive`.
 *
 * Build it section by section (see the TODOs). View at /lp.
 * For interactivity (scroll reveals, hero animation) split a piece into its own
 * "use client" component under src/components/lp/ and import it here.
 */
export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ── Nav ─────────────────────────────────────────────────────────────
          TODO: make it sticky + backdrop-blur + shrink-on-scroll.
          Hint: `sticky top-0 z-50 backdrop-blur border-b border-border`. */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <svg
            viewBox="0 0 100 100"
            className="h-6 w-6 text-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth={9}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M50 20 a15 15 0 0 1 0 30" />
            <path d="M50 80 a15 15 0 0 1 0 -30" />
            <line x1="50" y1="18" x2="50" y2="82" style={{ stroke: "var(--brand)" }} />
          </svg>
          Pintle
        </span>
        {/* TODO: nav links + a brand CTA button */}
        <Link
          href="/sign-in"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          Get started
        </Link>
      </nav>

      {/* ── Hero (the thesis) ───────────────────────────────────────────────
          The one "cool" moment. Big grotesk headline + subcopy + 2 CTAs + a
          hero visual. TODO: add an orchestrated animation (reuse the mark's
          180° pivot, or an animated Connect→Map→Validate→Rehearse→Cutover
          pipeline). Respect `prefers-reduced-motion`. Refs: paper.design,
          browserops.ai (build-spec DNA is in docs/design/lp-build-spec.md). */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Migrate like you deploy: <span className="text-brand">rehearse, ship, roll back.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          The only customer-data migration platform you can rehearse against live data, verify by
          diff, and undo in one click — self-hostable, so data never leaves your infra.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Start a migration
          </Link>
          <a
            href="#how"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
          >
            See how it works
          </a>
        </div>

        {/* TODO: hero visual goes here (the animated bit) */}
        <div className="mt-16 grid h-72 place-items-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground">
          hero visual — build the animated pipeline / pivot here
        </div>
      </section>

      {/* ── TODO sections (build these) ─────────────────────────────────────
          3. The wedge — "Flatfile gets data in. Rocketlane runs the project.
             Nobody moves it safely." Three-column contrast.
          4. How it works (id="how") — the 5-stage pipeline; scroll-linked
             highlight via IntersectionObserver.
          5. Feature bento — rehearse / reconcile / rollback / recipes / self-host.
          6. Self-host + security band.
          7. CTA + footer.
          See docs/design/lp-build-spec.md for the extracted DNA + per-section hints. */}

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        © Pintle — build the rest of me.
      </footer>
    </main>
  );
}
