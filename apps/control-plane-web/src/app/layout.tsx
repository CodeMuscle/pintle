import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Migration Control Tower",
  description: "Internal control plane for customer data migrations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html lang="en">
        <body className="antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
