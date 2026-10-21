import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./wiki.css";
import { WikiApp } from "./WikiApp";

createRoot(document.getElementById("wiki-root")!).render(
  <StrictMode>
    <WikiApp />
  </StrictMode>,
);
