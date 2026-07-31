/**
 * Shared Prettier config for the Migration Tower monorepo.
 * Consumed via `"prettier": "@pintle/prettier-config"` in package.json.
 *
 * @type {import("prettier").Config}
 */
module.exports = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
};
