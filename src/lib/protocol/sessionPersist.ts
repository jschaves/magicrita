import { saveUnlockedRsec } from "./session";
import { restKeyFromHex, setRestKey } from "./rest";

/**
 * Sesion recordada ("mantener la sesion"). Cerrar y volver a abrir la app no
 * pide la contraseña local; solo se vuelve a pedir tras **cerrar sesion** o
 * **borrar la identidad** (que vacia este almacen).
 *
 * La rsec no se guarda en claro: se cifra con **AES-GCM** usando una clave
 * **no extraible** que vive en el IndexedDB del propio dispositivo. Al no poder
 * exportarse, copiar su valor no sirve fuera de este origen. Donde no haya
 * WebCrypto o IndexedDB (o Safari falle al releer una `CryptoKey`) no se guarda
 * nada y se mantiene el comportamiento con contraseña.
 */
const DB_NAME = "magicrita-session";
const STORE = "records";
const KEY_ID = "deviceKey";
const SESSION_ID = "session";

type DeviceKeyRecord = { id: typeof KEY_ID; key: CryptoKey };
type SessionRecord = {
  id: typeof SESSION_ID;
  rpub: string;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
};
type StoreRecord = DeviceKeyRecord | SessionRecord;

let dbPromise: Promise<IDBDatabase> | null = null;

function supported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("indexeddb"));
    };
  });
  return dbPromise;
}

function read<T extends StoreRecord>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

function write(db: IDBDatabase, record: StoreRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
    tx.objectStore(STORE).put(record);
  });
}

function remove(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
    tx.objectStore(STORE).delete(id);
  });
}

/** Clave del dispositivo, no extraible. `create` la genera la primera vez. */
async function deviceKey(db: IDBDatabase, create: boolean): Promise<CryptoKey | null> {
  const existing = await read<DeviceKeyRecord>(db, KEY_ID);
  if (existing?.key) return existing.key;
  if (!create) return null;
  const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])) as CryptoKey;
  await write(db, { id: KEY_ID, key });
  return key;
}

export async function rememberSession(rsec: string, rpub: string, restKeyHex: string | null): Promise<void> {
  if (!supported()) return;
  try {
    const db = await openDb();
    const key = await deviceKey(db, true);
    if (!key) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Se guarda tambien la clave de cifrado en reposo para que reabrir no pida la
    // contrasena y el log/media sigan legibles. El contenido entero va cifrado
    // bajo la clave no extraible del dispositivo.
    const payload = JSON.stringify({ rsec, rest: restKeyHex });
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(payload),
    );
    await write(db, { id: SESSION_ID, rpub, iv, data });
  } catch {
    // Sin persistencia: se volvera a pedir la contraseña.
  }
}

export async function forgetSession(): Promise<void> {
  if (!supported()) return;
  try {
    const db = await openDb();
    await remove(db, SESSION_ID);
  } catch {
    // ignore
  }
}

/**
 * Deja la rsec en la memoria de la pestaña si habia una sesion recordada valida.
 * Se llama antes de montar la app, de modo que el arranque sale ya en "ready".
 */
export async function restoreRememberedSession(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const db = await openDb();
    const record = await read<SessionRecord>(db, SESSION_ID);
    if (!record?.rpub || !record.iv || !record.data) return false;
    const key = await deviceKey(db, false);
    if (!key) return false;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, key, record.data);
    const payload = new TextDecoder().decode(plain);
    // Formato nuevo: JSON con la rsec y la clave de reposo. Formato viejo: la
    // rsec a pelo (sin clave de reposo, el log se lee como texto plano legado).
    if (payload.startsWith("{")) {
      const parsed = JSON.parse(payload) as { rsec?: string; rest?: string | null };
      if (!parsed.rsec) return false;
      saveUnlockedRsec(parsed.rsec);
      setRestKey(restKeyFromHex(parsed.rest ?? null));
      return true;
    }
    saveUnlockedRsec(payload);
    return true;
  } catch {
    return false;
  }
}
