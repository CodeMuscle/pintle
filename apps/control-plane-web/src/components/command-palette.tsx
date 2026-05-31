"use client";

import { useClerk } from "@clerk/nextjs";
import { Command } from "cmdk";
import { LayoutDashboard, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Global ⌘K / Ctrl-K command palette. Mount once in the (app) layout.
 * Built on `cmdk` directly (headless, accessible) + Tailwind via the
 * library's `[cmdk-*]` attribute selectors.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { signOut } = useClerk();

  // Global hotkey: ⌘K / Ctrl-K toggles the dialog from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      title="Command palette"
    >
      <Command.Input placeholder="Type a command or search..." autoFocus />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>

        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => go("/")}>
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Account">
          <Command.Item
            onSelect={() => {
              setOpen(false);
              void signOut({ redirectUrl: "/sign-in" });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
