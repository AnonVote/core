const { execSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..", "..");

function run(label, cmds) {
  console.log(`\n=== ${label} ===`);
  for (const cmd of cmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: root, stdio: "inherit" });
  }
}

try {
  run("ESBUILD", [
    "node tests/bundler-compat/esbuild/esbuild.build.js",
    "node tests/bundler-compat/esbuild/bundle.out.js",
  ]);

  run("WEBPACK", [
    "npx webpack --config tests/bundler-compat/webpack/webpack.config.js",
    "node tests/bundler-compat/webpack/bundle.out.js",
  ]);

  run("VITE", [
    "npx vite build --config tests/bundler-compat/vite/vite.config.ts",
    "node tests/bundler-compat/vite/bundle.out.mjs",
  ]);

  console.log("\nAll bundler compatibility tests passed.");
} catch (err) {
  console.error("\nBundler compatibility test failed.");
  process.exit(1);
}