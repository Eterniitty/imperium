import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./styles.css";
// Niebla de guerra: pide al servidor el detalle de los sistemas descubiertos.
import "./state/details";
import "./state/claims";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
