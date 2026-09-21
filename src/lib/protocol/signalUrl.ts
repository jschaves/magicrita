export function loadSignalUrl(): string {
  const env = import.meta.env.VITE_SIGNAL_URL;
  if (typeof env === "string" && env.trim()) return env.trim();
  if (import.meta.env.DEV) return "ws://localhost:8787";
  if (typeof location !== "undefined") {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/signal/`;
  }
  return "";
}
