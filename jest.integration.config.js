/**
 * Integration tier — the fast suite, gated in CI.
 *
 * `testMatch` deliberately names a single directory level, so
 * `tests/integration/stress/` is excluded by construction rather than by an
 * ignore pattern someone can forget to update.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/integration/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          types: ["node", "jest"],
        },
      },
    ],
  },
};
