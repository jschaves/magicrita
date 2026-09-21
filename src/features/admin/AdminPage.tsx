import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";

type Blocks = { users: string[]; comments: string[] };
type LivePeer = { rpub: string; name: string };

const TOKEN_KEY = "magicrita.adminToken";

async function api(path: string, init?: RequestInit) {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error || res.status));
  return data;
}

export function AdminPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Blocks>({ users: [], comments: [] });
  const [live, setLive] = useState<LivePeer[]>([]);
  const [userId, setUserId] = useState("");
  const [commentId, setCommentId] = useState("");

  async function refresh() {
    const session = (await api("/admin-api/session")) as { live?: LivePeer[] };
    const next = (await api("/admin-api/blocks")) as Blocks;
    setLive(Array.isArray(session.live) ? session.live : []);
    setBlocks({
      users: Array.isArray(next.users) ? next.users : [],
      comments: Array.isArray(next.comments) ? next.comments : [],
    });
  }

  useEffect(() => {
    if (!authed) return;
    void refresh().catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      setAuthed(false);
    });
  }, [authed]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = (await api("/admin-api/login", {
        method: "POST",
        body: JSON.stringify({ user, password }),
      })) as { token?: string };
      if (!data.token) throw new Error("sesion");
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setAuthed(true);
      setPassword("");
    } catch {
      setError("Usuario o contraseña incorrectos.");
    }
  }

  async function block(kind: "user" | "comment", id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    const next = (await api("/admin-api/blocks", {
      method: "POST",
      body: JSON.stringify({ kind, id: trimmed }),
    })) as Blocks;
    setBlocks(next);
    if (kind === "user") setUserId("");
    else setCommentId("");
  }

  async function unblock(kind: "user" | "comment", id: string) {
    const next = (await api("/admin-api/blocks", {
      method: "DELETE",
      body: JSON.stringify({ kind, id }),
    })) as Blocks;
    setBlocks(next);
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="font-display text-3xl">Administración</h1>
        <form className="mt-8 space-y-4" onSubmit={(e) => void login(e)}>
          <TextField
            label="Usuario"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
          <TextField
            label="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Administración</h1>
        <Button
          variant="ghost"
          onClick={() => {
            sessionStorage.removeItem(TOKEN_KEY);
            setAuthed(false);
          }}
        >
          Salir
        </Button>
      </div>

      <section className="mt-8 rounded-2xl border border-line bg-paper p-4">
        <h2 className="font-semibold">Usuarios conectados ahora</h2>
        {live.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nadie conectado.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {live.map((peer) => (
              <li key={peer.rpub} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{peer.name || "sin nombre"}</span>
                  <span className="block truncate text-xs text-muted">{peer.rpub}</span>
                </span>
                <Button variant="danger" onClick={() => void block("user", peer.rpub)}>
                  Bloquear
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-paper p-4">
        <h2 className="font-semibold">Bloquear usuario (rpub)</h2>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void block("user", userId);
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-2xl border border-line px-3 py-2 text-sm"
            placeholder="rpub_…"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <Button type="submit">Bloquear</Button>
        </form>
        <ul className="mt-4 space-y-2 text-sm">
          {blocks.users.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="break-all">{id}</span>
              <Button variant="ghost" onClick={() => void unblock("user", id)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-paper p-4">
        <h2 className="font-semibold">Bloquear comentario o nota (firma)</h2>
        <p className="mt-1 text-xs text-muted">Pega el sig del comentario o de la publicación.</p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void block("comment", commentId);
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-2xl border border-line px-3 py-2 text-sm"
            placeholder="sig…"
            value={commentId}
            onChange={(e) => setCommentId(e.target.value)}
          />
          <Button type="submit">Bloquear</Button>
        </form>
        <ul className="mt-4 space-y-2 text-sm">
          {blocks.comments.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="break-all">{id}</span>
              <Button variant="ghost" onClick={() => void unblock("comment", id)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
