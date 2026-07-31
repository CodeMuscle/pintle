import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/lp(.*)",
  "/product(.*)",
  "/pricing(.*)",
  "/changelog(.*)",
  "/docs(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Route protection
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

// Clerk matcher
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
