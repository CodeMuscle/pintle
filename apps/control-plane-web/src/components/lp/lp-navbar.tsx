"use client";

import Link from "next/link";
import React, { useEffect } from "react";

const LPNavbar = () => {
  const [scrolled, setScrolled] = React.useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 5);

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 backdrop-blur transition-colors ${scrolled ? "border-b border-border bg-background/80" : "bg-transparent"}`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href={`/lp`} className="flex items-center gap-1 font-semibold tracking-tight">
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
        </Link>

        <div className="hidden md:flex md:flex-row gap-7 items-center justify-center">
          <Link
            href="/product"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-250"
          >
            Product
          </Link>
          <Link
            href="/pricing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-250"
          >
            Pricing
          </Link>
          <Link
            href="/changelog"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-250"
          >
            Changelog
          </Link>
          <Link
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-250"
          >
            Docs
          </Link>
        </div>

        <Link
          href="/sign-in"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          Get started
        </Link>
      </div>
    </nav>
  );
};

export default LPNavbar;
