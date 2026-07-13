import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import "./index.css";
import "./styles/theme.css";

// Apply saved accent color and font size before first render
// so there's no flash of default styles
const savedAccent = localStorage.getItem("anonvote-accent") || "#059669";
document.documentElement.style.setProperty("--brand-primary", savedAccent);
document.documentElement.style.setProperty("--brand-primary-dim", savedAccent);
document.documentElement.style.setProperty(
  "--brand-primary-pale",
  savedAccent + "14",
);

const savedFontSize = localStorage.getItem("anonvote-font-size");
if (savedFontSize) {
  document.documentElement.style.setProperty("--text-base", savedFontSize);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
