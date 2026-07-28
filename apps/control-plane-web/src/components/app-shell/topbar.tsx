import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cn } from "@pintle/ui";

interface TopbarProps {
  className?: string;
}

export function Topbar({ className }: TopbarProps) {
  return (
    <header className={cn("flex items-center justify-between", className)}>
      <div className="flex items-center gap-2">
        <kbd className="hidden items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
          <span className="text-[12px]">⌘</span>K
        </kbd>
        <span className="hidden text-xs text-muted-foreground md:inline">to search</span>
      </div>
      <div className="flex items-center gap-3">
        <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/" />
        <UserButton />
      </div>
    </header>
  );
}
