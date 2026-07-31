import Link from "next/link";
import React from "react";

import InstallPill from "./install-pill";

const Hero = () => {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
        Migrate like you deploy: <span className="text-brand">rehearse, ship, roll back.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        The only <span className="font-bold">1-click</span> customer-data migration platform you can{" "}
        <br /> rehearse against live data, verify and undo
      </p>
      <InstallPill />
      <div className="mt-4 flex items-center justify-center gap-3">
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

      {/* Hero visual goes here (the animated bit) */}
      <div className="mt-16 grid h-72 place-items-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground">
        hero visual — build the animated pipeline / pivot here
      </div>
    </section>
  );
};

export default Hero;
