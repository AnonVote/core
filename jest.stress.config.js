/**
 * Stress tier — opt-in only. Not run by `npm test`, `npm run test:integration`,
 * or CI. Volume lives here so the fast tier can stay under its 5s ceiling.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/integration/stress/*.test.ts"],
  // Thousands of AES round-trips and Paillier operations; the 5s default is
  // not a meaningful limit here.
  testTimeout: 300_000,
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
