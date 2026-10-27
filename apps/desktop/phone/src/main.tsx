import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./sw-register";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from the phone page");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registerServiceWorker();
