import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: { default: "Pintle", template: "%s · Pintle" },
  description:
    "Rehearse, cut over, and roll back customer-data migrations — verifiably, reversibly, on your own infra.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      afterSignOutUrl="/sign-in"
      localization={{
        signIn: { start: { title: "Sign in to Pintle" } },
        signUp: { start: { title: "Create your Pintle account" } },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body className="antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
