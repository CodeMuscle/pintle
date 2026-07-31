/**
 * Root ESLint config for the monorepo. Individual packages inherit this; web
 * apps and React libraries may add `extends: ["@pintle/eslint-config/react"]`
 * in their own .eslintrc.cjs when they introduce JSX.
 */
module.exports = {
  root: true,
  extends: ["@pintle/eslint-config"],
};
