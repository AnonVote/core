import js from "@eslint/js";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}", "tests/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    rules: js.configs.recommended.rules,
  },
];
