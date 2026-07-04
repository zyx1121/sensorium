import { config } from "@sensorium/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
];
