"use client";

import { Button } from "@migrationtower/ui";

import { useMe } from "@/lib/api/hooks";
import { useSessionStore } from "@/lib/stores/session-store";

export default function DashboardPage() {
  const tenantId = useSessionStore((s) => s.tenantId);
  const { data, isLoading, error } = useMe();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Phase&nbsp;1 Lesson&nbsp;6 — app shell wiring check.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          /v1/me
        </h2>
        {!tenantId && (
          <p className="text-sm text-muted-foreground">
            Pick an organisation from the switcher above to load your tenant.
          </p>
        )}
        {tenantId && isLoading && <p className="text-sm">Loading…</p>}
        {error instanceof Error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-medium">
                {data.user.fullName} &middot; {data.user.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Tenant</dt>
              <dd className="font-medium">{data.tenant.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Roles</dt>
              <dd className="font-medium">{data.roles.join(", ")}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-1 text-xs text-muted-foreground">
              <dt>X-Tenant-Id</dt>
              <dd className="font-mono">{tenantId}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
      </div>
    </div>
  );
}
