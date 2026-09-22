import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { spawn } from "node:child_process";
import { sanitizeAdminPath } from "./src/lib/sanitizeAdminPath";

function signalPlugin() {
  return {
    name: "magicrita-signal",
    configureServer() {
      spawn(process.execPath, ["server/signal.mjs"], {
        stdio: "inherit",
        windowsHide: true,
      }).on("error", () => {
        // ya hay un señalizador en el puerto, o Node no pudo arrancarlo
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const adminPath = sanitizeAdminPath(env.RUTA_ADMINISTRACION || env.ADMIN_PATH);
  return {
    define: {
      "import.meta.env.VITE_ADMIN_PATH": JSON.stringify(adminPath),
    },
    plugins: [signalPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: 5173,
      host: true,
      watch: {
        usePolling: true,
        interval: 1000,
      },
      proxy: {
        "/moderation": "http://127.0.0.1:8787",
        "/admin-api": "http://127.0.0.1:8787",
        "/brand": "http://127.0.0.1:8787",
        "/beta": "http://127.0.0.1:8787",
      },
    },
  };
});
