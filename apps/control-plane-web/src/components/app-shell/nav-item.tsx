"use client";

import { cn } from "@pintle/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}

export function NavItem({ href, icon, children, disabled }: NavItemProps) {
  const pathname = usePathname();
  const active = pathname === href;

  const base = "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors";
  const enabled = active
    ? "bg-accent text-accent-foreground"
    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground";
  const disabledStyle = "cursor-not-allowed text-muted-foreground/50";

  if (disabled) {
    return (
      <span className={cn(base, disabledStyle)} aria-disabled>
        {icon}
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={cn(base, enabled)}>
      {icon}
      {children}
    </Link>
  );
}
