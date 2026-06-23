import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { warmSpriteCache } from "./utils/spriteCache";
import "./styles/styles.css";
import "./styles/menu.css";
import "./styles/home-landing.css";

warmSpriteCache();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
