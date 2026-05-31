"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { posthog } from "./posthog-provider";

/**
 * Capture a PostHog pageview on every route change. Next App Router
 * doesn't trigger a full reload so PostHog's auto-capture misses these.
 */
export function usePageviewTracking() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);
}
