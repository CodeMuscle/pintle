import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 10% of transactions traced — adjust later based on volume budget.
  tracesSampleRate: 0.1,
  // No session replay in dev; capture replays only on error in prod.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  // Don't send anything when DSN is empty (dev without an account).
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
