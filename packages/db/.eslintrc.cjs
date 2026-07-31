/**
 * @pintle/db ESLint. Inherits the shared config; seed/CLI scripts
 * under prisma/ are allowed to write to stdout (that's their job). src/ stays
 * strict (no-console warns there, as in the rest of the monorepo).
 */
module.exports = {
  extends: ["@pintle/eslint-config"],
  overrides: [
    {
      files: ["prisma/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
  ],
};
