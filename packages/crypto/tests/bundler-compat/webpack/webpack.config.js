const path = require("path");

module.exports = {
  entry: path.join(__dirname, "app.js"),
  target: "node", // important: SDK uses Node's crypto module
  mode: "production",
  output: {
    path: __dirname,
    filename: "bundle.out.js",
  },
  externals: {
    // keep Node built-ins external instead of trying to polyfill them
  },
};