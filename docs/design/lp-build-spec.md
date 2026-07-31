# Landing Page — Build Spec (DNA + section hints)

> A coaching spec for building the LP yourself at `apps/control-plane-web/src/app/lp/page.tsx`
> (view `/lp`). Reuses `@pintle/ui` tokens. DNA extracted via Hallmark `study`
> from the references you picked. Build top-down; each section names the
> **frontend technique to practice**.

## Source DNA

**paper.design** (studied 2026-07-31):

- **Genre:** modern-minimal, professional, dual light/dark.
- **Hero:** centered, stacked — big headline + one-line subhead + dual CTAs, then a
  large product-UI visual (they use paired light/dark mockup images; static, not autoplay).
- **Macrostructure:** nav → hero → featured UI mockup → social-proof logos → a stack of
  feature sections (each = heading + copy + a supporting visual) → roadmap/announcement
  teaser → multi-column footer.
- **Nav:** horizontal links (pricing, roadmap, blog, changelog, docs), sticky.
- **Motion:** restrained — scroll-based lazy image reveals, theme switch. No heavy keyframes.
- (Fonts/exact colors not exposed — it's a JS SPA shell. Use our own: `@pintle/ui` tokens + a grotesk display.)

**browserops.ai** (studied from screenshot, 2026-07-31) — **light, not dark:**

- **Type:** heavy bold grotesk display (~800 weight, tight leading), centered. Grey lighter-weight subhead.
- **Nav:** top bar — icon + wordmark left; text links (Docs, Writings, Privacy) right; a **black pill CTA** ("Talk to a founder").
- **Hero:** fully centered — huge 2-line headline → grey 2-line subhead → a **terminal install pill**
  (black rounded bar, mono `curl -fsSL …/install | bash` + copy icon) → a secondary outline button
  ("Add to Chrome"). Minimal, high-contrast, lots of whitespace.
- **Hero visual:** a large realistic **product-window mockup** (app UI mid-task) sitting below the fold-line.
- **Signature move:** a **pixelated / dithered tulip-field** (red/yellow/green mosaic) bleeding up from the
  bottom edges into white — the one unexpected, memorable burst of colour against an otherwise monochrome page.
- **Palette:** near-monochrome (black text / white bg / grey subtext, black CTAs) + that single pixel-art image as the only colour.

**What to steal for Pintle:** the centered heavy-grotesk hero; the **install-command pill** (perfect for our
self-host story — `docker compose up` or a `curl … | install` line); a product-window mockup as the hero visual;
and above all **one signature element** so the page isn't just clean-minimal (browserops has its pixel field —
Pintle's should be the animated pipeline, or a dithered brand-teal gradient bleed at the bottom).

## Verdict — which to follow

**paper.design is the backbone.** It's the stronger overall system for an enterprise,
self-hostable infra tool — dual-theme, restrained, structured feature rhythm. Build Pintle's
LP on its macrostructure.

From **browserops.ai, graft only two things** (don't copy its look — the pixel-tulip field
reads consumer/playful, wrong for a migration tool a bank buys):

1. the **install-command pill** in the hero — it sells self-host in one line;
2. the principle of **one signature element** so the page isn't generic-clean.

Everything below follows this.

## Direction for Pintle

- **Genre:** modern-minimal (matches paper.design + our infra/B2B positioning).
- **Type:** grotesk display (tight tracking, weights 600–640) + the app body font; mono for
  small labels/metrics. Headings roman, never italic.
- **Color:** reuse tokens — `bg-background`, `text-foreground`, one `text-brand`/`bg-brand`
  accent spent sparingly, `text-muted-foreground` for secondary. Dual-theme comes free.
- **Motion budget:** ONE orchestrated hero moment + subtle scroll reveals. Nothing else.
  `prefers-reduced-motion` collapses spatial motion to a fade.

## Sections (build in this order)

1. **Sticky nav** — wordmark + 3–4 links + a `bg-brand` CTA.
   _Practice:_ `sticky top-0 z-50`, `backdrop-blur`, a hairline `border-b` that appears on scroll
   (toggle a class past ~8px scrollY).

2. **Hero (the thesis)** — headline "Migrate like you deploy: rehearse, ship, roll back."
   - one-line subhead + two CTAs, centered. Then the hero visual.
     _Practice:_ the one animation. Cheapest strong option — an **animated pipeline**
     (Connect → Map → Validate → Rehearse → Cutover) where a token travels the stages and the
     last one flips green ("reconciled → cutover unlocked"). Or reuse the mark's **180° pivot**.
     Build it as a `"use client"` component in `src/components/lp/`. Gate all of it behind
     `@media (prefers-reduced-motion: reduce)`.

3. **The wedge** — three columns: "Flatfile gets data in · Rocketlane runs the project ·
   **Pintle moves it safely**." The third is accented.
   _Practice:_ CSS grid, `md:grid-cols-3`, the accented card raised with `bg-card` + brand border.

4. **How it works** (`id="how"`) — the 5-stage pipeline explained.
   _Practice:_ `IntersectionObserver` to highlight the active stage as it scrolls into view.

5. **Feature bento** — rehearse · reconcile · rollback · recipes · self-host. Uneven tiles.
   _Practice:_ CSS grid with deliberate asymmetry (`col-span-2`/`row-span-2`), hover lift
   (`transition-transform hover:-translate-y-0.5`).

6. **Self-host / security band** — one confident line + a short proof list (RBAC, audit log,
   air-gap, your keys). Full-bleed contrast band (`bg-primary text-primary-foreground` or a
   dark section) to break the rhythm.

7. **Closing CTA + footer** — one CTA, then a multi-column footer (product / docs / company /
   social). _Honest copy:_ no invented metrics or fake logos until they're real.

## Guardrails (so it doesn't read AI-generated)

- Spend the accent in one place per section; keep the rest neutral.
- Real content only — no "trusted by 50,000+" or fabricated stats.
- Vary section rhythm — don't make every section `heading → 3 cards`. Alternate centered,
  split, full-bleed, and asymmetric-grid.
- One hero animation, not scattered effects everywhere.

## Start here

Nav + hero first (steps 1–2) — that's 80% of the "cool." Get it feeling right at 375px and
1280px before adding sections 3–7. Ping me to `study` a screenshot of browserops.ai if you
want its hero energy folded into step 2.
