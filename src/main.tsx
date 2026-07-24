import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; overflow: hidden; }
  :root { --ui-opacity: 1; }
  /* True window transparency: html/body must be transparent so desktop shows
     through surface alphas — NOT element opacity (which only dims content). */
  html, body {
    background: transparent !important;
  }
  body {
    font-family: var(--font-body, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif);
    color: var(--fg, #eee);
    -webkit-font-smoothing: antialiased;
  }
  #root {
    height: 100%;
    background: transparent;
  }
  /* .app itself stays transparent so child regions each paint ONE translucent layer
     (sidebar / content / panes). Nested var(--bg) on top of .app caused uneven opacity. */
  .app {
    background: transparent;
    min-height: 100%;
  }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
