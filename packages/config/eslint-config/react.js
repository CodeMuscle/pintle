/**
 * React/Next.js ESLint config — layered on top of the base config.
 * Use from web apps and React libraries:
 *   { "extends": ["@pintle/eslint-config/react"] }
 */
module.exports = {
  extends: ["./index.js"],
  env: {
    browser: true,
  },
  settings: {
    react: { version: "detect" },
  },
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
