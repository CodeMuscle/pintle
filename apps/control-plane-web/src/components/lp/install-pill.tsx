"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import Toast from "./toast";

const INSTALL_CMD = "git clone https://github.com/CodeMuscle/pintle.git";

const InstallPill = () => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ponytail: clipboard blocked (insecure context / denied) — leave the
      // icon alone rather than flash a checkmark for a copy that didn't happen.
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy install command: ${INSTALL_CMD}`}
        className={`group mt-9 inline-flex items-center gap-3 rounded-[10px] hover:bg-foreground/90 px-4 py-2.5 text-background transition-all duration-150 bg-foreground active:scale-[0.98] sm:px-5 sm:py-3 cursor-pointer`}
      >
        <code className="font-mono tracking-[-0.005em] text-xs">{INSTALL_CMD}</code>
        {copied ? (
          <Check className="size-4 text-success" />
        ) : (
          <Copy className="size-4 opacity-70 transition-opacity group-hover:opacity-100" />
        )}
        <span className="sr-only" aria-live="polite">
          {copied ? "Copied to clipboard" : ""}
        </span>
      </button>

      <Toast open={copied} message="Copied to clipboard" />
    </>
  );
};

export default InstallPill;
