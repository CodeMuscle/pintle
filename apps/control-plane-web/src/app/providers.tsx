"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Suspense, useState } from "react";

import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { usePageviewTracking } from "@/lib/analytics/use-pageview-tracking";
import { useSessionBootstrap } from "@/lib/hooks/use-session-bootstrap";

/**
 * Zero-render tracker. `usePageviewTracking` calls `useSearchParams`, which
 * forces its consumer out of static prerender — so it must live in its own
 * component behind <Suspense>, isolating the bail-out to this node instead of
 * the whole app subtree.
 */
function PageviewTracker() {
  usePageviewTracking();
  return null;
}

/** Inner client component so the pageview hook can use Next/navigation hooks. */
function InnerProviders({ children }: { children: React.ReactNode }) {
  useSessionBootstrap();
  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <PostHogProvider>
      <QueryClientProvider client={queryClient}>
        <InnerProviders>{children}</InnerProviders>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </PostHogProvider>
  );
}
