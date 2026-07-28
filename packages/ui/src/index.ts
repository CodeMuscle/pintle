/**
 * @pintle/ui — Shared React design system on Tailwind v4 + shadcn/ui.
 *
 * Apps consume this in two pieces:
 *   1. `import "@pintle/ui/styles.css"` in the app's root layout
 *      (registers Tailwind, shadcn tokens, dark variant, animation keyframes).
 *   2. `import { Button } from "@pintle/ui"` for individual primitives.
 *
 * For Tailwind to actually generate classes for the primitives' source files,
 * each consuming app's own globals.css must add an `@source` directive
 * pointing at this package's src/ — see the app for the exact line.
 */
export { cn } from "./lib/cn.js";
export { Button, buttonVariants, type ButtonProps } from "./components/button.js";
