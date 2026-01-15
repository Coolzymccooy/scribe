import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Bootstraps the ScribeAI application. Using React 18's
// createRoot allows us to opt into concurrent rendering when it
// becomes available. We wrap the application in StrictMode to
// surface potential problems during development.

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

