# MagicRita

MagicRita is a **local-first social network with its own protocol**. It is not a Nostr, Mastodon, ActivityPub, or Farcaster client. Identity, posts, media, and chat are MagicRita envelopes (`rpub` / `rsec` + Ed25519 signatures). Protocol detail lives in `docs/PROTOCOLO.md`.

The product is **100% decentralized for social data**. There is no account server, no post database, and no cloud that owns your life. Your identity, notes, photos, audio, video, follows, and encrypted chat live on **your device**. When someone else is online, envelopes travel **peer to peer** over WebRTC. The only shared machine is a **signaling relay**: it introduces browsers that are connected *right now*. It does not store posts, profiles, or secret keys. A RAM mailbox for a briefly absent peer is wiped when the process restarts.

You are the owner and custodian of your information. There is no central recovery: if you lose the secret key (`rsec`) without setting up **social recovery** with guardians, the account is gone.

MagicRita **does not use email for anything**. There is no signup by mail, no verification mail, no password reset, and no notifications by mail. The app **neither sends nor receives email**. Identity is the key on your device, not an inbox. (The beta invitation code is handed out by a human over email; the app itself never mails anything.)

### Examples

**Computer**

<img src="docs/images/post%20pc.jpg" alt="MagicRita feed on a computer" width="800">

**Phone**

<img src="docs/images/post%20mobile.jpg" alt="MagicRita feed on a phone" width="180">
<img src="docs/images/live%20mobile.jpg" alt="MagicRita live streams on a phone" width="180">
<img src="docs/images/chat%20mobile.jpg" alt="MagicRita one-to-one chat on a phone" width="180">
<img src="docs/images/call%20mobile.jpg" alt="MagicRita voice call on a phone" width="180">
<img src="docs/images/video%20call%20mobile.jpg" alt="MagicRita video call on a phone" width="180">
<img src="docs/images/chats%20mobile.jpg" alt="MagicRita chat list on a phone" width="180">
<img src="docs/images/saved%20mobile.jpg" alt="MagicRita saved notes on a phone" width="180">
<img src="docs/images/settings%20mobile.jpg" alt="MagicRita settings on a phone" width="180">

## Security first

Security is the design constraint, not a feature bolted on. Nothing secret ever reaches the relay, and nothing the relay receives is trusted until it is verified locally.

| Threat | Defense |
| --- | --- |
| Relay reads your identity | The relay never holds `rsec`. It only sees the public `rpub` and a signed `hello`. |
| Stolen device / storage | The secret is sealed in a local vault: **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`, 32-byte key) + **XChaCha20-Poly1305**. Unlocking needs your password on that device. The session is then remembered (the `rsec` re-encrypted with an **AES-GCM non-extractable device key** in IndexedDB), so the password is asked again only after **log out** or **delete identity**. **Encryption at rest:** the same vault also carries a random 32-byte at-rest key that seals every per-author log (`localStorage`) and every media byte (`IndexedDB`) with **XChaCha20-Poly1305** (prefix `mrest1:` / magic `MRB1`); without the key they read as empty, and old plaintext is re-encrypted on first unlock. |
| Forged or altered content | Every envelope is **Ed25519**-signed over canonical JSON of `v`, `type`, `author`, `ts`, `body`; remote envelopes are verified before they are stored. |
| Malicious payloads | Received envelopes pass hard limits (total size, depth, key/item counts, string lengths, media refs, forward `ts` skew) before they are accepted. |
| Impersonation on the relay | `hello` is signed with the `rsec` over a **single-use nonce** issued by the relay (on connect, and again on `scan`/`ping` only while the socket is unbound). One socket = one identity; a rejected `hello` does not immediately get a new nonce, so it cannot spin a `hello`/`challenge` loop. |
| DoS / spam floods | Proof of work on `hello` (16 bits) plus RAM-only per-IP and per-`rpub` rate limits on sockets, hellos, and each message type. |
| Man-in-the-middle in chat | Chat is end-to-end: Ed25519 keys are converted to Montgomery form, **X25519** ECDH gives a shared secret, hashed with **SHA-256**, sealed with **XChaCha20-Poly1305**. The relay forwards a box it cannot read. |
| Eavesdropping on calls | Voice and video calls are **P2P** over WebRTC with **DTLS-SRTP**. Their SDP/ICE signaling is **signed with the `rsec`** and the receiver verifies the signature against the peer's `rpub` (bound to the call id, the media type and the recipient), so the relay cannot alter the DTLS fingerprints or inject ICE candidates: no MITM. Microphone and camera need a secure context and the user's permission. |
| Spoofed or stored live streams | Live is **ephemeral**: the announcement, each stream's SDP/ICE, and the **live chat/reactions** are **Ed25519-signed with the `rsec`** and bound to the stream id, the recipient and the original author, so the relay cannot fake, rewire or reattribute a stream message. Nothing about a live is written to disk or the relay; it exists only while it is being announced and vanishes when it ends. |
| Admin brute force | Admin login needs a **signed proof-of-work captcha** (18 bits, issued per attempt, single-use) plus timing-safe credential compare and a per-IP fail limit. |
| Cross-origin abuse of admin routes | `/admin-api/*` checks the `Origin` and never sets CORS; the bearer token is kept **in memory** (no cookies, no disk). |
| XSS / injection | A strict `Content-Security-Policy` (`default-src 'self'`, no `object-src`, `frame-ancestors 'none'`). The production build drops `script-src 'unsafe-inline'` (dev keeps it for React Refresh) and tightens `connect-src` to the signaling host; nginx adds the header (needed for `frame-ancestors`), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`. |
| Tracking | No cookies, no analytics, no third-party scripts, and no fonts or images fetched from other hosts. WebRTC uses a STUN server (default `stun.cloudflare.com`, configurable with `VITE_STUN_URL`), which sees your public IP; peers see it too, as is inherent to P2P. |
| Abusive content (UGC) | A **non-skippable terms gate** (`terms.*` in `src/i18n/messages.ts`, stored by `src/lib/protocol/terms.ts`) must be accepted before creating an identity or posting; the terms define prohibited content. In-app **report** and **block** cover posts, comments, and 1:1 chat, and the relay operator can block an `rpub`. |
| Losing the key with no central recovery | **Social recovery**: the `rsec` is split with **Shamir (M of N)** and each share is **XChaCha20-Poly1305**-encrypted with a key derived from the owner's recovery password (scrypt) before it is sent to a guardian. Guardians store an opaque blob they cannot read; recovering needs M shares + the password, with no server or email. |
| Forged/tampered content out of context | **Verifiable provenance**: a `magicrita-proof` carries the signed envelope as portable text and is re-verified offline (Ed25519 over canonical JSON); peers can add **co-signatures** (`attest`) as proof they saw it. |
| Moving data across an air gap | **Offline sync** packs already-signed envelopes into `magicrita-sync:1:` text; every envelope is **re-verified** on import, and nothing is trusted just because it arrived through a manual channel. |

Libraries `@noble/curves`, `@noble/ciphers`, and `@noble/hashes` are **math only**. They are not a social network.

---

## How it works

### Frontend (browser)

- **Vite 7 + React 19 + TypeScript + Tailwind 4**, one SPA. Routes: `/welcome`, `/welcome/create`, `/welcome/import`, `/welcome/recover`, `/unlock`, `/` (home feed), `/people`, `/saved`, `/protocolo` (`/discover` redirects here), `/compose`, `/n/:id`, `/p/:rpub`, `/messages`, `/messages/:rpub`, `/live`, `/settings`, `/legal`, plus the admin panel at a configurable path.
- **Storage:** `localStorage` holds the vault, per-author logs (encrypted at rest, see below), saves, locale, the beta-invite cache, the accepted-terms flag, and the signup guard; `sessionStorage` holds the ephemeral alerts list and the cached `hello` proof of work. **IndexedDB** holds media bytes (encrypted at rest) and 8-bit previews, and the remembered session (AES-GCM ciphertext + a non-extractable device key). Profiles and posts embed a small inline thumbnail (≤8 KB), so avatars and photos show at once and are swapped for the full image once its bytes reach the device. Nothing is uploaded to a server.
- **Feed:** live notes as they arrive, newest `ts` first, no ranking and no engagement reordering. Young untrusted keys stay out of home until followed, invited, or older than 12 h (peers seen live skip that quarantine). Pause/resume.
- **Compose:** text, one optional photo, optional voice, optional video; media-only notes allowed. You may edit a post or comment for 15 minutes; after that you can only delete.
- **People / profile:** who is online now, follows, and signed 7-day invites (an `invite` envelope). Chats start from People or a profile.
- **Messages:** request / accept / revoke / block; text is sealed in the browser, at most 280 characters per line. In an open chat the phone button starts a **P2P voice call** and the screen button a **P2P video call** (WebRTC); only SDP/ICE signaling goes through the relay. Both buttons are always shown while the chat is open and are **icon-only** (they carry an accessible label). An incoming call (voice or video) plays a ringtone, generated with **Web Audio** (no files, no third parties), until it is accepted, declined or times out. Everything is stored only on the device.
- **Live:** peer-to-peer camera broadcasts from the header's radio icon. The icon opens `/live`, which lists the streams that are live right now — first the ones you follow (oldest first), then the rest, **5 per page** — with a **Create live** button on top. An announcement is signed and refreshes every few seconds; a stream that stops refreshing disappears. Each viewer opens a one-way P2P connection with the broadcaster (one `RTCPeerConnection` per viewer). Viewers can **comment** (up to 280 characters, like a post comment) and send **emoji reactions**; each comment and each floating reaction shows the **sender's avatar next to it** (comments anchored on the right-hand band over the video, reactions floating up and fading; a connected peer's avatar comes from the inline `hello` thumbnail, so it paints at once). The broadcaster re-broadcasts viewer messages to everyone else. **Nothing is stored** — no envelope, no file, no server; when it ends, it is gone.
- **Settings:** profile, language, export/import (`magicrita-bundle`), logout, delete-identity, and **change the local password** (it re-wraps the vault; after changing you are signed out to log in with the new one). Closing and reopening the app keeps you signed in; **log out** is what brings the password prompt back. There is a shared header with the alerts bell and the messages counter.
- **Onboarding:** a non-skippable **terms of use** gate (accept the rules before creating an identity or posting), then create an identity (local canvas captcha, no Google/phone/KYC), import an `rsec`, import a portable file, or **recover with shares**; unlock an existing vault with your password.
- **Tools (Settings → advanced):** *verifiable provenance* — export any note as a signed `magicrita-proof` and verify proofs pasted back without trusting a server, and co-sign (`attest`) notes you saw; *offline sync* — pack every known signed envelope into a portable `magicrita-sync:1:` text to move it to another device with **no network** (USB, messaging, QR), re-verified on import; *social recovery* — split the `rsec` with **Shamir (M of N)** into password-encrypted shares handed to chosen contacts, so a lost device is recovered by gathering M shares and the recovery password. No server, no email, no phone.

### Backend (relay)

- **`server/signal.mjs`** — Node + `ws`, **RAM only**. It never serves the SPA and never stores notes, profiles, or keys. In memory it keeps: who is online (`live`/`byRpub`), a small **mailbox** of signed envelopes for a briefly absent peer (≤ 250 envelopes, each ≤ 24 KB, 30 min TTL), and a **blob box** of media chunks waiting for a peer (≤ 800 chunks / 32 MB, 30 min TTL). A restart empties all of it.
- **HTTP routes:** `GET /beta`, `POST /beta/check`, `GET /admin-path`, `GET /brand`, `GET /brand/logo`, `GET /admin-api/captcha`, `POST /admin-api/login`, and the token-guarded admin API (`/admin-api/session`, `/admin-api/blocks`, `/admin-api/invites`, `/admin-api/invites/toggle`, `/admin-api/admin-path`, `/admin-api/logo`), plus `POST /moderation/check`.
- **WebSocket:** `hello` (signed + PoW, plus a valid beta invite when the beta is closed) → `challenge`, `hello-ok`, `join`, `leave`, `peers`, `held`; then `signal` (WebRTC SDP/ICE, for the data channels and for voice calls), `hold`, `pic`, `blob`, `need-blob`, `scan`/`ping`, and `moderation-changed`. The relay introduces peers; once a data channel is open, envelopes and media move **peer to peer**.
- **Limits (all RAM, wiped on restart):** hello 60/min per `rpub` and 240/min per IP; ≤ 16 sockets and ≤ 16 distinct `rpub` per IP; per-type message budgets (`blob` 2500/min, `pic` 240/min, `need-blob` 60/min, `signal` 240/min, `hold` 30/min); `/beta/check` 10 per 10 min per IP; `/moderation/check` 30 calls/min per IP; admin login 8 failures per 15 min per IP. `X-Forwarded-For` is trusted only when `TRUST_PROXY` is set.
- **Admin:** beta invite codes are created and managed **only in the panel** (stored in clear in `data/beta-invites.json`, on purpose, so they can be re-copied); a code works only while it exists and is enabled. The admin can block an `rpub` or a signature, change the panel path at runtime, and upload the site logo. That is moderation of **this relay**, not a global ban.

### Mobile

- One responsive SPA, **no PWA and no service worker**. It uses `viewport-fit=cover`, safe-area insets, `dvh` sizing, and a bottom dock whose controls hide while the on-screen keyboard is open. The header carries the alerts bell and the messages counter.
- Microphone and camera need a **secure context**: `https://` or `http://localhost` / `127.0.0.1`, never a LAN IP such as `http://192.168.x.x`.
- One identity per browser. Two accounts need two browsers (or a window plus incognito), both online together for WebRTC.

## Cryptography

| Layer | What it does |
| --- | --- |
| **Identity** | Ed25519 key pair. Public id `rpub_` + 64 hex. Secret `rsec_` + 64 hex. The relay never holds `rsec`. |
| **Envelopes** | Every profile, post, follow, block, like, comment, report, invite, delete, gone, and chat event is signed Ed25519 over canonical JSON of `v`, `type`, `author`, `ts`, `body`. Remote events are verified and size-checked before they are stored. |
| **Vault** | The secret is wrapped in the browser with **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`, 32-byte key) and **XChaCha20-Poly1305**. Unlocking needs your password on this device. The unlocked key lives in the tab's memory and, to survive a restart, is also kept **AES-GCM-encrypted** under a non-extractable device key in IndexedDB; it is erased on log out or delete identity. |
| **Encryption at rest** | A random 32-byte key (kept inside the vault and the remembered session, never in the clear) seals every per-author log and every media byte with **XChaCha20-Poly1305** (`mrest1:` / `MRB1`). Missing the key returns empty, never a bad decode; old plaintext is migrated on first unlock. |
| **Backup** | `magicrita-bundle` is your encrypted identity, notes, and photos. Optionally the whole file can be sealed with a password (**scrypt** + **XChaCha20-Poly1305**), so notes and media are encrypted too; empty password keeps the plaintext container (only the `rsec` was ever encrypted). |
| **Chat** | End-to-end. **X25519** ECDH (Ed25519 → Montgomery), shared secret hashed with **SHA-256**, then **XChaCha20-Poly1305** (24-byte nonce). The relay forwards a signed box it cannot read. |
| **Media** | Photos, voice, and video are hashed with **SHA-256**. The hash sits in the envelope; the bytes stay in IndexedDB and move P2P. The relay does not keep the files. |
| **Hello / anti-spam** | WebSocket `hello` carries a SHA-256 proof of work (`rita-pow-v1:rpub:nonce`, 16 bits) and an Ed25519 signature over a one-time nonce. |
| **Admin captcha** | A per-attempt signed challenge solved with an 18-bit proof of work (`rita-captcha-v1`); nothing is stored on the relay beyond the spent nonce. |
| **Browser check on unlock** | A local proof of work (18 bits) in the same style as the admin captcha, run on this device to make each unlock attempt cost CPU. It is a local speed bump, not a server-verified boundary: the real cost is the vault's scrypt. |

## Automatic deletion and limits

MagicRita is built so that **old data leaves the device by itself**. There is no infinite server history.

- At most **100 posts** per author in this browser. Publishing another one drops the oldest, including its photo, audio, or video.
- At most **100 chats** on this device. When another conversation arrives, the one that has gone longest without a message is removed, including its media. Each chat also keeps at most **100 messages**; older lines are pruned.
- Each author's local log has a **byte ceiling**; when it is exceeded, the oldest heavy events (posts and their previews) are trimmed. The profile and the small control envelopes (`follows`, `blocks`, `gone`, `invite`, `chat_consent`, `delete`) are **never** trimmed, so the account never looks empty.
- If localStorage or IndexedDB hits quota, the client frees the **oldest 25%** of posts and chat events for the author being written first, and only then for others; it also emits signed `delete` envelopes so others hide those targets. A `gone` envelope marks an author as absent without destroying local history.
- Saved posts that point at a deleted note disappear from Saved.
- Explicit `delete` / `gone` envelopes hide the target in the feed and in People where this browser knows about it.
- You may **edit a post or comment for 15 minutes**; after that you can only delete.
- The relay's RAM mailbox is **empty after a restart**. It is not a backup.

Limits that travel with content: **280 characters** per post, comment, and chat line; **50** for the display name; **160** for the bio; **one photo** per note (JPEG, PNG, WEBP, or GIF, 8 MB); **voice up to 30 s** (mono WAV, 1.2 MB); **video up to 10 s** (8 MB). A post may carry a small image preview (up to 8,000 characters) so it shows something before the full file arrives.

---

## Anti-spam (no user database)

Spam cannot be “banned at the protocol” the way a company account can. Defenses are local and in-RAM:

- Proof of work on `hello` and a signed, single-use challenge.
- Per-IP and per-`rpub` rate limits on the relay (sockets, hellos, messages, mailbox, beta checks, admin login). Not persisted.
- Signed invites (7 days). Follows and unexpired invites make an author trusted.
- Young keys: hidden from home/comments until trusted or 12 h old; 3 reports hide them (10 reports for others).
- At most two links per note or comment; repeated identical text is dropped.
- Client-side signup guard: one local account per browser, create-rate limit, and a **local canvas captcha** (no Google, no phone, no email, no KYC). The app does not send or receive mail.
- The admin panel can block an `rpub` for this operator's relay; that is moderation of the signaling node, not a global kill switch for the key.

## Product surface

- **Welcome** — pitch, relay model, encrypted chat, posts, and portable/`rsec` import. Locale from the browser or Settings (English, Spanish, Portuguese, French, Arabic, Russian, Chinese, Japanese, Italian, German). Arabic is RTL. Notes you write are not auto-translated.
- **Feed** — live notes as they arrive, newest first. Pause/resume.
- **Publish** — text, optional photo, optional voice, optional video. Media-only notes are allowed.
- **Comments** — 280 characters, emoji picker, voice, same report/hide rules as notes.
- **People** — who is online now, follows, signed 7-day invites.
- **Messages** — only conversations that already have lines, plus an inbox of chat requests. Request / accept / revoke / block stay on the thread. On mobile the long explanation sits behind an **Info** button so the chat list keeps the space.
- **Alerts** — last 10 notices locally (chat, request, invite); the bell and the messages counter sit in the header.
- **Saved** — local list of post signatures; deleted targets are dropped.
- **Hashtags** — writing `#word` in a note or comment makes it a link; tapping it filters Home (or Saved, depending on where you are) to the notes containing that hashtag, comments included. A banner shows the active tag with a clear button.
- **Settings** — language, profile, export/import, logout, delete-identity. Signal URL is **not** chosen in the UI; it is fixed at build (`VITE_SIGNAL_URL` or same-host `/signal/`).
- **Legal** — `/legal` (beta notes, 16+, Germany/EU relay, no tracking cookies).
- **Admin** — Spanish panel at `RUTA_ADMINISTRACION` (default `/topogue`, rotatable at runtime): login with a proof-of-work captcha, live peers, user/comment blocks, beta invites, runtime panel path, site logo, and an assembly-diagnostics view. API under `/admin-api/` with a bearer token kept in memory (no cookies). **Web build only** — the Android app ships without the panel.

One identity per browser. Two accounts need two browsers (or a window plus incognito), both online together for WebRTC.

## What is built (all five protocol steps)

1. **Local identity** — Create or import an Ed25519 identity. The `rsec` is encrypted in the browser vault. Profile and notes are signed and stored only on this device.
2. **Portable account** — Export a `magicrita-bundle` (encrypted identity, notes, and media) and import it in another browser or device. You can password-protect the whole file so notes and media are encrypted too. The file is *your* copy; it does not open someone else’s session. Signatures and media hashes are verified on import.
3. **Own relay** — WebRTC signaling, a live peer list, and an in-RAM mailbox. No notes, profiles, or keys on disk.
4. **Encrypted chat** — Request, accept, revoke, or block on either side. Messages send only when both latest `chat_consent` events are on. Block also turns consent off.
5. **Media** — Signed SHA-256 refs in the envelope. One photo per note. Voice (mono WAV) and video (file or camera, auto-stop at 10 s) in posts and chat. Files travel between peers and in the portable export; the relay does not store them.

The in-app protocol page and the sidebar philosophy copy mark these steps done. A persistent federated history store is **not** in scope: it would contradict “we do not store your life on a server.”

## Beta

This is a trial. The beta is **invite-only** while invite codes exist in the panel; if the panel has no codes, it is open. The invite code is **requested by email** — it is not published anywhere. It can be revoked at any time (delete or disable it in the panel) without notice, and the project can be deleted without prior warning. The invite is checked when **creating an account**, **importing an identity or backup**, and on the relay's WebSocket **`hello`**: a connection without a valid code is rejected. It is **not** required to unlock an account already stored on this device. If a saved or bundled code is no longer valid, it is discarded and you are asked for a new one.

---

## Stack

| Piece | Choice |
| --- | --- |
| App | Vite 7, React 19, TypeScript, Tailwind 4 |
| Crypto | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` |
| Relay | `server/signal.mjs` (Node, `ws`), RAM only |
| Local store | `localStorage` (logs, vault, locale), IndexedDB (media, remembered session) |
| Transport | WebSocket signaling + WebRTC mesh |
| Production web | Static `dist/` behind nginx; the signaler does **not** serve the SPA |
| Android (APK) | Same SPA built with `vite build --mode android`; the relay is an external server configured in `.env.android` |

Scripts: `npm run dev` (Vite on port 5173; it spawns the relay and, on startup, replaces a stale orphaned relay still holding the port), `npm run signal`, `npm run build` (`tsc -b && vite build`), `npm run build:android` (Android bundle into `dist-android/`, no admin panel), `npm run cap:sync` (build:android + sync the `android/` Capacitor project), `npm run cap:open` (open it in Android Studio), `npm run preview`. Node **18+**.

The app **does not set cookies**. The signaler does not send `Set-Cookie`.

---

## Requirements on any machine

- **Git**
- **Node.js 18 or newer** (includes `npm`)
- Access to the private GitHub repository

```bash
git --version
node --version
npm --version
```

## Clone

**HTTPS** (GitHub will ask for a user and a Personal Access Token with `repo` scope, not the account password):

```bash
git clone https://github.com/jschaves/magicrita.git
cd magicrita
```

**SSH** (if a key is added on GitHub):

```bash
git clone git@github.com:jschaves/magicrita.git
cd magicrita
```

## Environment

`.env` is **not** in Git. On each new machine:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

| Variable | Use |
| --- | --- |
| `ADMIN_USER` | Admin panel user |
| `ADMIN_PASSWORD` | Admin panel password |
| `RUTA_ADMINISTRACION` | Admin URL path (default `topogue`). Restart `npm run dev`; production needs a rebuild |
| `PORT` | Signaler port (default `8787`) |
| `HOST` | Signaler bind address. `.env.example` uses `127.0.0.1`; production must keep it behind nginx and never expose the relay |
| `VITE_SIGNAL_URL` | Only when **building** for production if signaling is not on the same host (example `wss://magicrita.com/signal/`). Required for the Android build, where the relay is external |
| `VITE_API_BASE` | Only for the **Android build**: absolute base of the relay's HTTP API (example `https://magicrita.com`). Empty on web, where the SPA and the relay share the origin |
| `VITE_APP_TARGET` | `android` compiles the APK: no admin panel and the relay URL comes from the config file |
| `ADMIN_ORIGINS` | Comma-separated extra origins allowed to call `/admin-api/*`. `localhost` and the relay's own host (`Origin` host = request `Host`) are always allowed |
| `TRUST_PROXY` | Set to `1` **only** behind a reverse proxy. Configure nginx to **overwrite** `X-Forwarded-For` (`$remote_addr`, not `$proxy_add_x_forwarded_for`), else per-IP limits can be spoofed |
| `VITE_STUN_URL` | STUN server for WebRTC (default `stun:stun.cloudflare.com:3478`) |

`node_modules/`, `dist/`, and `data/` are also local. `data/` holds admin blocks, beta invites, the runtime admin path, and the uploaded logo.

## Local development

```bash
npm ci
npm run dev
```

If `npm ci` fails (for example after a manual dependency edit), use `npm install`.

Open **http://localhost:5173/** (prefer localhost over a LAN IP so the mic and camera work and the beta bypasses stay consistent). The signaler starts on port `8787`; `npm run dev` replaces a stale relay still holding that port so you never talk to an old build. The admin panel is `http://localhost:5173/` plus `RUTA_ADMINISTRACION` (default `/topogue`).

Stop with Ctrl+C. After relay or `.env` changes, restart `npm run dev` so `signal.mjs` reloads.

## Production (Linux VPS)

The public site is static files. `git pull` alone does **not** update what people see; you must build.

1. Clone (section above) and enter the directory.
2. Install dependencies and create `.env` (admin credentials, `HOST=127.0.0.1`, `TRUST_PROXY=1` behind nginx, optional `ADMIN_ORIGINS`). Beta invite codes are created later in the admin panel, not in `.env`.
3. Build. Same-host signaling needs no `VITE_SIGNAL_URL`; set `VITE_STUN_URL` only if you use your own STUN server:

```bash
npm ci
npm run build
```

If signaling is on another host:

```bash
VITE_SIGNAL_URL=wss://your-domain/signal/ npm run build
```

4. Run the signaler and serve `dist/` with nginx. Step-by-step Ubuntu: `docs/INSTALAR-VPS.md`. Relay, nginx, and systemd: `docs/VPS.md`.

Typical layout: nginx on 80/443, `root` = `dist/`, proxy `/signal/`, `/admin-api/`, `/moderation/`, `/beta`, `/brand` to `127.0.0.1:8787`. Firewall only 22/80/443. After build, `chmod` so `www-data` can read `dist`.

**Required in production:** the relay must stay on `127.0.0.1` and `TRUST_PROXY=1` must be set, with nginx **overwriting** `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $remote_addr;`). Otherwise per-IP limits and the 16-socket cap break (shared proxy IP) or become spoofable. nginx must also send the security headers (`Content-Security-Policy` with `frame-ancestors`, `nosniff`, `DENY`, `no-referrer`); both `docs/VPS.md` and `docs/INSTALAR-VPS.md` include them.

```bash
npm run signal
```

The signaler does not serve the web UI.

Preferred hosting for the beta: a small VPS in **Germany (EU)** so the relay stays in the EU. Scale is concurrent WebSockets, not account count (there is no user table).

## Android (APK)

The Android bundle is the same SPA compiled with `vite build --mode android`. The **relay is not inside the app**: it lives on an external server, configured in `.env.android` (committed; it holds only public URLs). That file sets `VITE_APP_TARGET=android`, `VITE_SIGNAL_URL=wss://magicrita.com/signal/`, and `VITE_API_BASE=https://magicrita.com`.

- **No admin panel.** `/admin-api/*`, `/admin-path`, and the admin route are not part of the Android app; the panel stays **web-only**. The admin code is loaded through a dynamic import guarded by `VITE_APP_TARGET`, so `AdminPage` and `adminPath` are not emitted in `dist-android/`.
- **External relay.** On web, HTTP calls are same-origin; inside the app the origin is the app itself, so every API call (`/beta`, `/beta/check`, `/brand`, `/brand/logo`, `/moderation/check`) goes through `apiUrl()`, which prefixes `VITE_API_BASE` (empty on web, so same-origin behavior does not change).
- **CSP.** The Android build adds the relay host to `connect-src` (`wss://` and `https://`), `img-src`, and `media-src`, because `'self'` there is the app origin, not the relay.
- **Still zero server storage.** Identity, notes, media, and chats stay on the device (WebView `localStorage`/IndexedDB). The relay only signals.
- **Native bits.** Export uses the share sheet (`@capacitor/filesystem` + `@capacitor/share`); the `rsec` copy button uses `@capacitor/clipboard`; the hardware back button navigates history or exits (`@capacitor/app`); the alerts bell uses **local notifications** (`@capacitor/local-notifications`, channel `magicrita`), because the browser `Notification` API has no WebView equivalent. Camera/microphone/notification prompts come from the WebView or the plugin once the manifest permissions are granted. Notifications are scheduled by the app when an envelope arrives while it is connected — there is **no push service**, so nothing wakes the device if the app is fully closed.
- **STUN.** WebRTC uses the STUN server from `VITE_STUN_URL` (default `stun.cloudflare.com:3478`).

```bash
npm run build:android   # output in dist-android/
npm run cap:sync        # build:android + copy into the android/ project
npm run cap:open        # open the android/ project in Android Studio
```

The `android/` Capacitor project is committed. `cap:sync` regenerates its web assets (ignored by git) and registers the native plugins (`@capacitor/app`, `@capacitor/clipboard`, `@capacitor/filesystem`, `@capacitor/local-notifications`, `@capacitor/share`). The manifest declares `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and `POST_NOTIFICATIONS`, and disables Android Auto Backup (`allowBackup="false"`) so app data is not copied to Google. Building and signing the APK/AAB needs the Android SDK (Android Studio); see `docs/ANDROID.md`. The web build is unchanged.

## What is in Git and what is not

| In the repository | Only on each machine |
| --- | --- |
| Code (`src/`, `server/`, `docs/`, `android/`) and the Android icon set (`android_icons/`) | `node_modules/` |
| `package.json` and `package-lock.json` | `dist/` (`npm run build` output) |
| `LICENSE`, `.env.example`, `.env.android` (public URLs only) | `dist-android/` (`npm run build:android` output) |
| | `.env` (secrets) |
| | `data/` (admin blocks, beta invites, runtime path, logo) |

## Further documentation

- `docs/PROTOCOLO.md` — envelope format, identity, anti-spam
- `docs/VPS.md` — relay, nginx, systemd
- `docs/INSTALAR-VPS.md` — numbered install on a clean Ubuntu VPS
- `docs/INSTALAR-WINDOWS.md` — install web + admin on Windows 11 (no Android), and publish on a domain with HTTPS (nginx + win-acme)
- `docs/ANDROID.md` — Android/APK build plan (external relay, no admin)
- `LICENSE` — GNU Affero GPL v3

---

## Contact

Try it on our demo. Request a tester invitation, and the beta code, at the address below (a human reads that inbox; MagicRita itself never sends or receives email).

**Demo:** [https://magicrita.com](https://magicrita.com)

**Email:** [magicrita.beta@gmail.com](mailto:magicrita.beta@gmail.com)

---

## Contribute

**Code.** Open an issue or a pull request. Keep the protocol local-first: no account server, and no post store on the relay.

**Donate.** MagicRita is free software (no charge to run it). Support development on [Ko-fi](https://ko-fi.com/magicrita). For other questions, write to [magicrita.beta@gmail.com](mailto:magicrita.beta@gmail.com).

---

## License

Copyright (C) 2026 jschaves.

MagicRita is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). You may run, study, share, and change it.

If you run a modified MagicRita as a network service (your own relay or demo), AGPL requires you to offer that modified source to the people who use it.

There is no warranty. See `LICENSE` for the full terms.
