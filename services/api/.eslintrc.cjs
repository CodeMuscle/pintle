/**
 * @pintle/api ESLint. Inherits the shared config. NestJS DI relies on
 * runtime (value) imports of injected providers + emitDecoratorMetadata, so
 * the monorepo's `consistent-type-imports` (which would rewrite them to
 * `import type` and break DI) is disabled here. Decorator-heavy class
 * properties also need the unused-vars check relaxed for parameter props.
 */
module.exports = {
  extends: ["@pintle/eslint-config"],
  parserOptions: {
    sourceType: "module",
  },
  rules: {
    "@typescript-eslint/consistent-type-imports": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
};
