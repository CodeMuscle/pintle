"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { usePageviewTracking } from "@/lib/analytics/use-pageview-tracking";
import { useSessionBootstrap } from "@/lib/hooks/use-session-bootstrap";

/** Inner client component so the pageview hook can use Next/navigation hooks. */
function InnerProviders({ children }: { children: React.ReactNode }) {
  useSessionBootstrap();
  usePageviewTracking();
  return <>{children}</>;
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
