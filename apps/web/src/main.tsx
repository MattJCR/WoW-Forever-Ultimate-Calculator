import "@fontsource-variable/inter";
import "@fontsource-variable/cinzel";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/home.css";
import "./styles/class.css";
import "./styles/summary.css";
import "./styles/floating.css";
import "./styles/gear.css";
import "./styles/unassigned.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
