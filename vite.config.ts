import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";

/**
 * Copia local de `src/lib/sanitizeAdminPath`. NO se importa desde `src` a
 * proposito: si el config dependiera de un fichero de la app, cada edicion de
 * ese fichero reiniciaria el servidor de Vite (y con reinicios seguidos el
 * servicio de esbuild se cae: "The service is no longer running").
 */
const DEFAULT_ADMIN_PATH = "topogue";
const RESERVED_ADMIN_PATHS = new Set([
  "welcome",
  "unlock",
  "legal",
  "people",
  "saved",
  "protocolo",
  "discover",
  "compose",
  "messages",
  "settings",
  "n",
  "p",
  "brand",
  "beta",
  "signal",
  "admin-api",
  "moderation",
  "assets",
]);

function parseAdminPath(raw: string | undefined): string | null {
  const value = String(raw ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) return null;
  if (RESERVED_ADMIN_PATHS.has(value.toLowerCase())) return null;
  return value;
}

function sanitizeAdminPath(raw: string | undefined): string {
  return parseAdminPath(raw) ?? DEFAULT_ADMIN_PATH;
}

const RELAY_SCRIPT = "server/signal.mjs";
const RELAY_SALIR_ESPERA_MS = 150;
const RELAY_SALIR_INTENTOS = 20;

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ¿Alguien acepta conexiones en `port`? Un connect que falla es "libre". */
function puertoOcupado(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const terminar = (ocupado: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ocupado);
    };
    socket.setTimeout(600);
    socket.once("connect", () => terminar(true));
    socket.once("timeout", () => terminar(false));
    socket.once("error", () => terminar(false));
  });
}

/**
 * PIDs que escuchan en `port` y ademas son nuestro relay (`server/signal.mjs`).
 * El filtro por linea de comandos es a proposito: si el puerto lo ocupa otro
 * programa, matarlo seria un destrozo, y lo unico que queremos reemplazar es un
 * señalizador viejo que quedó huérfano de una sesión anterior.
 */
function pidsDelRelay(port: number): number[] {
  try {
    if (process.platform === "win32") {
      const salida = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue; if ($p.CommandLine -like '*${RELAY_SCRIPT}*') { $p.ProcessId } }`,
        ],
        { encoding: "utf8" },
      );
      return unicosPids(salida);
    }
    const salida = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return unicosPids(salida).filter((pid) => esRelay(pid));
  } catch {
    return [];
  }
}

function unicosPids(salida: string): number[] {
  return [...new Set(salida.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function esRelay(pid: number): boolean {
  try {
    const salida =
      process.platform === "win32"
        ? execFileSync(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`,
            ],
            { encoding: "utf8" },
          )
        : execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return salida.includes(RELAY_SCRIPT);
  } catch {
    return false;
  }
}

function matarPid(pid: number): void {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // ya no existe, o no hay permiso: el sondeo de puerto decide después
  }
}

/**
 * Al arrancar, un señalizador viejo puede seguir vivo en el puerto (por ejemplo
 * un `npm run dev` que se cerró mal y dejó el hijo huérfano). El hijo nuevo que
 * lanza Vite muere en silencio con EADDRINUSE y la app sigue hablando con el
 * relay obsoleto, que no tiene las rutas nuevas. Esto lo reemplaza.
 */
function signalPlugin(env: Record<string, string>): Plugin {
  return {
    name: "magicrita-signal",
    async configureServer(server) {
      const port = Number(env.PORT || process.env.PORT || 8787) || 8787;

      for (const pid of pidsDelRelay(port)) {
        console.log(`[magicrita] reemplazando señalizador obsoleto (pid ${pid}) en :${port}`);
        matarPid(pid);
      }

      for (let i = 0; i < RELAY_SALIR_INTENTOS && (await puertoOcupado(port)); i += 1) {
        await dormir(RELAY_SALIR_ESPERA_MS);
      }

      if (await puertoOcupado(port)) {
        console.warn(
          `[magicrita] el puerto ${port} está ocupado y no es ${RELAY_SCRIPT}; no arranco el relay.`,
        );
        return;
      }

      const hijo = spawn(process.execPath, [RELAY_SCRIPT], {
        stdio: "inherit",
        windowsHide: true,
      });
      hijo.on("error", () => {
        // ya hay un señalizador en el puerto, o Node no pudo arrancarlo
      });

      // Sin esto, cerrar Vite deja el relay huérfano y es justo lo que provoca
      // el problema que este bloque viene a resolver.
      const cerrar = () => {
        try {
          hijo.kill();
        } catch {
          // ya estaba muerto
        }
      };
      server.httpServer?.once("close", cerrar);
      process.once("exit", cerrar);
    },
  };
}

/**
 * Endurece la CSP solo en el build. En desarrollo hace falta `'unsafe-inline'`
 * en `script-src` por el preambulo de React Refresh que inyecta Vite; en
 * produccion no hay scripts en linea, y ademas se acota `connect-src` al host de
 * senalizacion en vez de permitir cualquier `ws:`/`wss:` (vector de exfiltracion
 * si hubiera un XSS).
 */
function cspPlugin(env: Record<string, string>): Plugin {
  return {
    name: "magicrita-csp",
    apply: "build",
    transformIndexHtml(html) {
      const signal = String(env.VITE_SIGNAL_URL || "").trim();
      let connect = "'self'";
      if (signal) {
        try {
          connect += ` ${new URL(signal).origin}`;
        } catch {
          // si no es una URL absoluta, se queda solo 'self'
        }
      }
      return html
        .replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")
        .replace("connect-src 'self' ws: wss:", `connect-src ${connect}`);
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
    plugins: [signalPlugin(env), react(), tailwindcss(), cspPlugin(env)],
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
        "/admin-path": "http://127.0.0.1:8787",
        "/brand": "http://127.0.0.1:8787",
        "/beta": "http://127.0.0.1:8787",
      },
    },
  };
});
