import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cn } from "@pintle/ui";

interface TopbarProps {
  className?: string;
}

export function Topbar({ className }: TopbarProps) {
  return (
    <header className={cn("flex items-center justify-between", className)}>
      {/* Left side reserved for breadcrumbs / page title later */}
      <div />
      <div className="flex items-center gap-3">
        <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/" />
        <UserButton />
      </div>
    </header>
  );
}
