/**
 * @pintle/worker-validation ESLint. Same DI-friendly overrides as
 * services/api: NestJS metadata reflection needs value (not type-only)
 * imports of injected providers.
 */
module.exports = {
  extends: ["@pintle/eslint-config"],
  parserOptions: { sourceType: "module" },
  rules: {
    "@typescript-eslint/consistent-type-imports": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
};
