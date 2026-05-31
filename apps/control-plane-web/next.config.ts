import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // …whatever you already have here (likely empty or default)
};

export default withSentryConfig(nextConfig, {
  // Only emit Sentry's webpack plugin output during a build (not dev).
  silent: true,
  // Upload source maps only when an auth token is available (production CI).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Disable Sentry's Vercel cron monitor (we're not on Vercel yet).
  automaticVercelMonitors: false,
});
