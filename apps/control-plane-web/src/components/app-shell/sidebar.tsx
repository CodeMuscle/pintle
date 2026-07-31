import { cn } from "@pintle/ui";
import { LayoutDashboard, FolderKanban } from "lucide-react";

import { NavItem } from "./nav-item";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside className={cn("flex flex-col gap-4 px-3 py-4", className)}>
      <div className="flex items-center gap-2 px-3 py-1">
        <svg
          viewBox="0 0 100 100"
          className="h-5 w-5 shrink-0 text-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M50 20 a15 15 0 0 1 0 30" />
          <path d="M50 80 a15 15 0 0 1 0 -30" />
          <line x1="50" y1="18" x2="50" y2="82" style={{ stroke: "var(--brand)" }} />
        </svg>
        <span className="text-sm font-semibold tracking-tight text-foreground">Pintle</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        <NavItem href="/" icon={<LayoutDashboard className="h-4 w-4" />}>
          Dashboard
        </NavItem>
        <NavItem href="/migrations" icon={<FolderKanban className="h-4 w-4" />} disabled>
          Migrations
          <span className="ml-auto text-[10px] text-muted-foreground">Phase&nbsp;2</span>
        </NavItem>
      </nav>
    </aside>
  );
}
