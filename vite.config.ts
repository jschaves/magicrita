import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { spawn } from "node:child_process";

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

export default defineConfig({
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
      interval: 300,
    },
    proxy: {
      "/moderation": "http://127.0.0.1:8787",
      "/admin-api": "http://127.0.0.1:8787",
      "/brand": "http://127.0.0.1:8787",
      "/beta": "http://127.0.0.1:8787",
    },
  },
});
