// @ts-check
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tsconfigPath = resolve(__dirname, "tsconfig.json");

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  // ── Ignored paths ──────────────────────────────────────────────────────────
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },

  // ── src/ — full type-aware linting ────────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: tsconfigPath,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      /** No console statements in library code — sensitive data risk. */
      "no-console": "error",

      /** Explicit `any` is a type-safety hole; use `unknown` instead. */
      "@typescript-eslint/no-explicit-any": "error",

      /** All exported functions must declare their return type explicitly. */
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],

      /** Dead variables silently hide bugs; treat them as errors. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ── tests/ & test files — syntax-only linting (exceptions for console allowed in tests) ────────
  {
    files: ["tests/**/*.ts", "src/**/*.test.ts", "src/**/*.spec.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // No `project` here — test files are excluded from the TS build.
        // Type-aware rules are not applied to tests.
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      /** Console output is allowed in tests for debugging and test reporting. */
      "no-console": "off",

      /** No explicit any in tests. */
      "@typescript-eslint/no-explicit-any": "error",

      /** Dead variables are still errors in tests. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
