import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Anything matching one of these is allowed without a session.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/lp(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  // Default: every route is protected. Public routes opt out.
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

// Standard Clerk matcher — runs on every page except static assets.
export const config = {
  matcher: [
    // Skip Next internals + static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
