import { cn } from "@pintle/ui";
import { LayoutDashboard, FolderKanban } from "lucide-react";

import { NavItem } from "./nav-item";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside className={cn("flex flex-col gap-4 px-3 py-4", className)}>
      <div className="px-3 py-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Migration Control Tower
        </span>
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
