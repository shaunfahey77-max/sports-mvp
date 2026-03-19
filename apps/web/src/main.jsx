// apps/web/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SubscriberProvider } from "./auth/SubscriberContext";

// ✅ import ONCE (visual design lives here)
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SubscriberProvider>
      <App />
    </SubscriberProvider>
  </React.StrictMode>
);
