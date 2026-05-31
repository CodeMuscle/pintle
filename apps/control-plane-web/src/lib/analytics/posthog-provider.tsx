"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { useEffect } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

/**
 * Initializes PostHog once on mount (KEY is missing → no-op). Pageviews
 * are captured manually via the `usePageviewTracking` hook so we get
 * Next.js App Router transitions (PostHog's auto-tracking misses some).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: false, // we'll do it ourselves via usePageviewTracking
      capture_pageleave: true,
      autocapture: true,
      person_profiles: "identified_only",
    });
  }, []);

  return <Provider client={posthog}>{children}</Provider>;
}

export { posthog };
