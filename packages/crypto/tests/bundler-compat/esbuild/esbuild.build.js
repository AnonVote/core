const esbuild = require("esbuild");
const path = require("path");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "app.js")],
    bundle: true,
    platform: "node", // important: SDK uses Node's crypto module
    target: "node18",
    outfile: path.join(__dirname, "bundle.out.js"),
    logLevel: "info", // so we can see warnings
  })
  .then(() => {
    console.log("esbuild: bundle created successfully");
  })
  .catch((err) => {
    console.error("esbuild: bundle failed", err);
    process.exit(1);
  });