import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminAuthProvider } from "./AdminAuthProvider";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminAuthProvider>
      <App />
    </AdminAuthProvider>
  </StrictMode>,
);
