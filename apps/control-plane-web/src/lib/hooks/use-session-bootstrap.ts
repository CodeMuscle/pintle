"use client";

import { useOrganization, useUser } from "@clerk/nextjs";
import { useEffect } from "react";

import { posthog } from "@/lib/analytics/posthog-provider";
import { useSessionStore } from "@/lib/stores/session-store";

/**
 * Two integration steps run on every sign-in / org switch:
 *   1. Mirror Clerk's active org metadata → session store (tenant id)
 *   2. Identify the user in PostHog with tenant + email
 */
export function useSessionBootstrap() {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { user, isLoaded: userLoaded } = useUser();
  const setTenantId = useSessionStore((s) => s.setTenantId);

  // 1. Clerk active org → session store
  useEffect(() => {
    if (!orgLoaded) return;
    const fromClerk = organization?.publicMetadata?.tenantId;
    setTenantId(typeof fromClerk === "string" ? fromClerk : null);
  }, [orgLoaded, organization, setTenantId]);

  // 2. Identify user in PostHog (idempotent — call on every load)
  useEffect(() => {
    if (!userLoaded || !user || !posthog.__loaded) return;
    posthog.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      tenantId: organization?.publicMetadata?.tenantId,
      org: organization?.name,
    });
  }, [userLoaded, user, organization]);
}
