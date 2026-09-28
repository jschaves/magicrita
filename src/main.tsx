import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { restoreRememberedSession } from "./lib/protocol/sessionPersist";
import "./index.css";

/**
 * Recupera la sesion recordada (rsec cifrada con una clave del dispositivo)
 * antes de montar la app, para que reabrirla no pida la contraseña local. Si no
 * hay nada guardado o falla, se arranca igual y se pide la contraseña.
 */
async function boot() {
  try {
    await restoreRememberedSession();
  } catch {
    // ignore
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
