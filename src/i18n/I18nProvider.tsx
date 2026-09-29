import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isProtocolError, type ProtocolErrorCode } from "@/lib/protocol/errors";
import {
  dictionaries,
  isLocale,
  isRtlLocale,
  LOCALES,
  type Locale,
  type Messages,
} from "./messages";

const STORAGE_KEY = "magicrita.locale";

type NestedKey<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object ? `${K}.${NestedKey<T[K]>}` : K;
    }[keyof T & string]
  : never;

export type MessageKey = NestedKey<Messages>;

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

type I18nContextValue = {
  locale: Locale;
  locales: typeof LOCALES;
  setLocale: (locale: Locale) => void;
  t: Translate;
  errorMessage: (error: unknown, fallback: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function localeFromNavigator(): Locale {
  if (typeof navigator === "undefined") return "en";
  const tags = [...(navigator.languages ?? []), navigator.language];
  for (const tag of tags) {
    if (!tag) continue;
    const short = tag.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return "en";
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // ignore
  }
  const found = localeFromNavigator();
  try {
    localStorage.setItem(STORAGE_KEY, found);
  } catch {
    // ignore
  }
  return found;
}

function lookup(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
    const description = dictionaries[locale].meta.description;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description);
  }, [locale]);

  const t = useCallback<Translate>(
    (key, vars) => {
      const text = lookup(dictionaries[locale], key) ?? lookup(dictionaries.es, key) ?? key;
      return interpolate(text, vars);
    },
    [locale],
  );

  const errorMessage = useCallback(
    (error: unknown, fallback: MessageKey) => {
      if (isProtocolError(error)) {
        // Las herramientas nuevas pueden lanzar codigos sin traduccion: en ese
        // caso se usa el texto de respaldo en vez de mostrar la clave cruda.
        const key = `errors.${error.code}`;
        if (lookup(dictionaries[locale], key) || lookup(dictionaries.es, key)) {
          return t(key as MessageKey);
        }
        return t(fallback);
      }
      if (error instanceof Error && error.message in dictionaries.es.errors) {
        return t(`errors.${error.message as ProtocolErrorCode}` as MessageKey);
      }
      return t(fallback);
    },
    [t],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, locales: LOCALES, setLocale, t, errorMessage }),
    [errorMessage, locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
}
