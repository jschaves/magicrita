import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Configuracion del proyecto Android (Capacitor).
 *
 * El bundle que se empaqueta es el de `dist-android` (`npm run build:android`):
 * sin panel de admin y con el relé externo declarado en `.env.android`. El relé
 * no vive dentro del APK.
 */
const config: CapacitorConfig = {
  appId: "com.magicrita.app",
  appName: "MagicRita",
  webDir: "dist-android",
  server: {
    // Esquema https dentro del WebView: contexto seguro, necesario para
    // localStorage/IndexedDB, clipboard y camara/micro.
    androidScheme: "https",
  },
  android: {
    // Todo el trafico es https/wss; no se permite contenido mixto.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      // Icono monocromo de la barra de estado (drawable-*/ic_notification.png,
      // del juego de android_icons) y color del acento de la marca.
      smallIcon: "ic_notification",
      iconColor: "#C61E6A",
    },
  },
};

export default config;
