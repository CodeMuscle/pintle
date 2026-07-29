import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn.js";

/**
 * Status + severity chip. State encoded in form as well as text so it reads at
 * a glance in a dense table. `tone` covers project/run status and validation
 * severity; the soft (tinted) fills keep the row calm — only `critical` shouts.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-muted text-muted-foreground",
        brand: "border-transparent bg-brand/12 text-brand",
        success: "border-transparent bg-success/14 text-success",
        warning: "border-transparent bg-warning/16 text-warning",
        critical: "border-transparent bg-destructive/14 text-destructive",
        outline: "border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
