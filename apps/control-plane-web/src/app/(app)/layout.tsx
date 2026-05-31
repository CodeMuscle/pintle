import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { CommandPalette } from "@/components/command-palette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[16rem_1fr] grid-rows-[3.5rem_1fr]">
      <Sidebar className="row-span-2 border-r border-border bg-card/40" />
      <Topbar className="border-b border-border bg-card/40 px-4" />
      <div className="overflow-y-auto p-6">{children}</div>
      <CommandPalette />
    </div>
  );
}
