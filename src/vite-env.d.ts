/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNAL_URL?: string;
  readonly VITE_ADMIN_PATH?: string;
  /** Base de la API HTTP del relé. Vacío en web (mismo origen); URL absoluta en el APK. */
  readonly VITE_API_BASE?: string;
  /** "android" compila sin panel de administración y con relé externo. */
  readonly VITE_APP_TARGET?: string;
  readonly VITE_STUN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
