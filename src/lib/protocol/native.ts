import { Capacitor } from "@capacitor/core";

/**
 * Utilidades que cambian entre el navegador y el APK (Capacitor). En web se usa
 * la API del navegador tal cual; en Android se delega en los plugins nativos,
 * porque dentro del WebView ni la descarga con `<a download>` ni
 * `navigator.clipboard` funcionan igual.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function copyText(text: string): Promise<void> {
  if (isNativeApp()) {
    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Boton atras de Android: navega hacia atras si hay historial y, si no, sale de
 * la app. Sin esto, el boton cerraria la actividad directamente. Devuelve una
 * funcion para desuscribirse. En web no hace nada.
 */
export async function wireAndroidBackButton(): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  return () => void handle.remove();
}

/**
 * Guarda un archivo de texto (por ejemplo el backup `magicrita-bundle`). En web
 * se descarga; en Android se escribe en la cache de la app y se ofrece con el
 * selector de compartir, que es la forma de sacarlo del WebView.
 */
export async function saveTextFile(name: string, data: string, mime: string): Promise<void> {
  if (isNativeApp()) {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const written = await Filesystem.writeFile({
      path: name,
      data,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, url: written.uri, dialogTitle: name });
    return;
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// Notificaciones: en web el aviso lo pinta `notices.ts` con la API del
// navegador; en el WebView del APK esa API no existe, asi que se pide permiso y
// se programa una notificacion local, que el sistema muestra aunque la app no
// este en primer plano.
const NOTIFICATION_CHANNEL = "magicrita";
let notificationsReady: Promise<boolean> | null = null;

/**
 * Pide permiso de notificaciones (en Android 13+ es un permiso en tiempo de
 * uso) y crea el canal. Idempotente: el resultado se cachea. Devuelve `false`
 * en web o si el usuario lo deniega.
 */
export function ensureNativeNotifications(): Promise<boolean> {
  if (!isNativeApp()) return Promise.resolve(false);
  if (!notificationsReady) {
    notificationsReady = (async () => {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return false;
      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL,
        name: "MagicRita",
        description: "Mensajes, peticiones de chat e invitaciones",
        importance: 4,
        visibility: 1,
      });
      return true;
    })().catch(() => false);
  }
  return notificationsReady;
}

/**
 * El plugin exige un entero de 32 bits como id de la notificacion, y aqui el
 * `tag` es la firma del sobre (texto). Se deriva un numero estable con FNV-1a:
 * la misma firma reemplaza su notificacion en vez de duplicarla.
 */
function notificationId(tag: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tag.length; i += 1) {
    hash ^= tag.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff || 1;
}

export async function notifyNative(title: string, body: string, tag: string): Promise<void> {
  if (!isNativeApp()) return;
  if (!(await ensureNativeNotifications())) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: notificationId(tag), title, body, channelId: NOTIFICATION_CHANNEL }],
    });
  } catch {
    // Si el sistema la rechaza, el aviso en la campana de la app sigue.
  }
}
