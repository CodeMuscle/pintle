"use client";

import { Check } from "lucide-react";
import React from "react";

const Toast = ({ open, message }: { open: boolean; message: string }) => {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed bottom-6 right-2 z-50 flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs shadow-lg transition-all duration-200 motion-reduce:transition-none ${open ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <Check className="size-4 text-success" />
      {message}
    </div>
  );
};

export default Toast;
