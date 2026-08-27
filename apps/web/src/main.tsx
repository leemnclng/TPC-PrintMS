import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

// Self-hosted brand fonts — no runtime network dependency, so the app keeps
// its look offline (this is a local-first desktop app).
import "@fontsource/bodoni-moda/500.css";
import "@fontsource/bodoni-moda/600.css";
import "@fontsource/bodoni-moda/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/forms.css";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* HashRouter: the production build is loaded from file:// inside
        Electron, where a path-based router can't resolve deep links. */}
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
