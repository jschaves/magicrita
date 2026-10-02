# MagicRita protocol

A network of our own. We do not use Nostr, ActivityPub, Farcaster, or any third-party social graph.
The `@noble/*` libraries are math only (signatures and encryption), not a network.

## How it is built (steps)

1. **Identity and local log** — done  
   Each person generates an Ed25519 pair. Everything they publish is a signed *envelope* and is stored on this device.
2. **Take your data to another environment** — done  
   You export a file with your encrypted identity, notes, and photos, then import it in another browser or device. It is your copy, not someone else’s session.
3. **Own relay** — done  
   WebRTC signaling, live peer list, and a RAM mailbox. It does not store notes or keys. Live exchange goes between browsers.
4. **Chat** — done  
   You ask anyone to chat; the other person accepts. Either of you can revoke or block. Text is encrypted (X25519 + XChaCha20) in a signed envelope; the relay cannot read it.
5. **Media** — done  
   SHA-256 hash in the envelope; one photo per note, plus voice (mono WAV, ≤ 30 s) and video (≤ 10 s) in posts and chat. Media travels between peers and in the portable file; the relay does not store it.

## Step 1 — format

Identity:

- `rpub_` + 64 hex — public key (your ID)
- `rsec_` + 64 hex — secret key (if it is lost, the identity is lost)

Signed envelope:

```json
{
  "v": 1,
  "type": "profile" | "post" | "follows",
  "author": "rpub_…",
  "ts": 1730000000000,
  "body": {},
  "sig": "<hex Ed25519>"
}
```

The canonical JSON of `v`, `type`, `author`, `ts`, and `body` is signed (without `sig`). Older envelopes signed with plain `JSON.stringify` key order are still accepted on receive.

The secret is sealed on the device with **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`) + **XChaCha20-Poly1305**; the unlocked key lives in the tab's memory and, to survive a restart, is also kept **AES-GCM-encrypted** under a non-extractable device key in IndexedDB (erased on log out or delete identity, so the password is asked again only then). The vault also carries a random 32-byte **at-rest key** (see below).

### Encryption at rest

Everything MagicRita keeps on the device is encrypted under a single random 32-byte
**at-rest key**: the per-author logs in `localStorage` and the media bytes in
`IndexedDB`. Each value is sealed with **XChaCha20-Poly1305** under that key; sealed
text carries the prefix `mrest1:` and sealed bytes the magic `MRB1`, so plaintext from
an older install is never mistaken for ciphertext. The key itself is never stored in
the clear: it lives inside the vault (which is encrypted with your password) and, for
the remembered session, inside the AES-GCM device record. Without the key (locked, or
the vault not yet opened) logs and media read as empty; a `null` is returned rather
than a wrong decode. The first time an old install is unlocked, plaintext logs and
media are **re-encrypted in place** (idempotent migration). This protects data at rest
if the device or browser profile is stolen; it does **not** hide public content, which
is still published signed but in the clear.

Every envelope received from the network also passes hard limits before it is stored: total size, nesting depth, key/item counts, string lengths, media refs, and a maximum forward `ts` skew (a signed future timestamp would break every “newest wins” rule).

## Step 2 — file

Package `magicrita-bundle`:

- `kind: "backup"` — your encrypted identity, notes, and photos, to continue in another environment. You may protect the whole file with a password: it is then sealed with **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`) + **XChaCha20-Poly1305** (`{"encrypted": true, kdf, N, r, p, salt, nonce, data}`), so notes and media are encrypted too and not just the identity. Leaving the password empty keeps the old plaintext container (only the `rsec` inside the vault is encrypted); the plaintext format is still accepted on import.

On import, every Ed25519 signature and every photo SHA-256 hash is verified. A password-protected backup asks for that password first; a wrong one fails without touching the device.

There is no account server and no content server.

## Tools: provenance, offline sync and social recovery

Three extra mechanisms, all on-device and peer-to-peer; the relay only carries the usual signaling and envelopes.

- **Verifiable provenance.** `magicrita-proof` is portable text `{ "schema": "magicrita-proof", "v": 1, "envelope": <signed envelope> }` for a `post`, `profile`, or `comment`. Anyone can re-verify it offline: the Ed25519 signature over the canonical JSON of `v`, `type`, `author`, `ts`, `body` must match the embedded `author`. Peers can also co-sign with an `attest` envelope (`body.target` = the signed envelope's `sig`), shown as confirmations.
- **Offline sync.** `magicrita-sync:1:<base64({ "v": 1, "envelopes": [...] })>` packs already-signed envelopes so they can be moved to another device with no network (file, clipboard, QR). Every envelope is re-verified with `isEnvelope` + `verifyEnvelope` on import; nothing is trusted just because it came over a manual channel.
- **Live streams.** Ephemeral and **never stored**: no envelope, no file. A broadcaster announces `{ id, title, startedAt }` and re-announces every few seconds over the relay's `signal` message (`payload.live`); a viewer sends `discover` to get the current list. Each signal (`announce`/`discover`/`join`/`leave`/`offer`/`answer`/`cand`) is **Ed25519-signed with the `rsec`** over `rita-live-v1` plus the stream id, the recipient, the signer and the body, and is verified against the relay's authenticated `from`. Each viewer gets its own one-way `RTCPeerConnection` from the broadcaster. Stops refreshing = gone.
- **Live chat and reactions.** Also ephemeral and **never stored** (no envelope, no file, no relay state). They are extra `LiveSignal` kinds over the same signed `signal` channel: `chat` (`{ author, at, text }`, at most **280 characters**, the same limit as a comment) and `reaction` (`{ author, at, emoji }`, one of a fixed emoji set). A viewer sends them to the broadcaster, which **re-broadcasts** them to the other viewers (the broadcaster is the only party that knows every viewer's `rpub`); the broadcaster's own messages go straight to all viewers. The original author travels in the signed `author` field so the relay cannot reattribute a comment. They exist only in RAM while the stream is live and vanish on leave/end/restart. The UI shows comments with the author's avatar on the right-hand band over the video, and reactions as emoji that float up and disappear.
- **Social recovery.** The 32-byte `rsec` is split with **Shamir over GF(256)** (poly `0x11d`) into N shares, M of which reconstruct it. Each share is encrypted with **XChaCha20-Poly1305** under a 32-byte key derived from the owner's **recovery password** with **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`) and a per-set salt, then sent to a guardian as a signed `recovery_share` envelope: `{ to, owner, id, index, total, threshold, generation, salt, n, box }`. The guardian stores an opaque blob it cannot read. Recovery gathers M owner-signed shares (from any channel) plus the password, decrypts each share, recombines the polynomial at `x = 0`, and checks that the resulting key's `rpub` equals `owner`. A new setup uses a new `generation`, invalidating old shares. No server, no email, no phone.

## Anti-spam (no disk on the relay)

- Every `hello` to the relay carries a SHA-256 proof of work (`rita-pow-v1:rpub:nonce`). The relay checks it in RAM and cuts IPs or keys that fire too often.
- `hello` is also **signed with the `rsec`** over a single-use nonce issued by the relay, and one socket serves one identity. A `rpub` cannot be listed without its signature. The relay issues that nonce when the socket opens and, if the socket is still unbound, on each `scan`/`ping`; a rejected `hello` does **not** get a fresh nonce right away, so a bad code or PoW cannot spin a `hello`/`challenge` loop.
- When the beta is closed, `hello` must carry a **valid invitation code**, or the relay rejects the connection. The check is server-side and does not count a use (that is only done when the code is redeemed during signup/import).
- The relay applies per-IP and per-`rpub` budgets: sockets, hellos, and each message type (`signal`, `hold`, `pic`, `blob`, `need-blob`). All of it is RAM only and vanishes on restart. The `signal` type carries both the data-channel and the voice-call (SDP/ICE) signaling; the relay forwards it without inspecting it.
- **Voice and video calls** are P2P WebRTC (DTLS-SRTP). Every call signal (offer/answer/ICE/hang-up) is **Ed25519-signed with the sender's `rsec`** over `rita-call-v1` plus the call id, the media type (audio/video), and the recipient `rpub`, and the receiver only accepts it if it matches the relay's authenticated `from` and verifies. So a malicious relay cannot rewrite the SDP fingerprint or inject ICE: it would need a `rsec` it never holds. The relay only relays the signaling and never sees the media.
- `invite` envelope: someone in your network signs a 7-day voucher toward an `rpub`. People you follow stop quarantining that person. There is no invite list on the server.
- Young accounts (under 12 h, with no follow and no invite) do not enter the home feed. With 3 reports they are hidden; others, at 10.
- At most two links per note or comment. The same text repeated is dropped.
- `delete` / `gone` hide a target. `gone` does **not** destroy local history: it marks the author absent, and newer activity brings them back.
