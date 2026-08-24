module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/src/tests/**/*.test.ts"],
  testMatch: ["**/tests/**/*.test.ts"],
  setupFiles: ["dotenv/config"],
};
