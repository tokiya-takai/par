import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "react-diff-view/style/index.css";
import "./styles.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
