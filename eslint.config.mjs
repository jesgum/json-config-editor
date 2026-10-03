import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["media/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, acquireVsCodeApi: "readonly", module: "readonly" },
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  }
);
