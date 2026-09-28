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
5. **Photos** — done  
   SHA-256 hash in the envelope, one photo per note, travels between peers and in the portable file. Image handling will not be expanded.

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

The secret is sealed on the device with **scrypt** (`N = 2¹⁵`, `r = 8`, `p = 1`) + **XChaCha20-Poly1305**; the unlocked key lives in the tab's memory and, to survive a restart, is also kept **AES-GCM-encrypted** under a non-extractable device key in IndexedDB (erased on log out or delete identity, so the password is asked again only then).

Every envelope received from the network also passes hard limits before it is stored: total size, nesting depth, key/item counts, string lengths, media refs, and a maximum forward `ts` skew (a signed future timestamp would break every “newest wins” rule).

## Step 2 — file

Package `magicrita-bundle`:

- `kind: "backup"` — your encrypted identity, notes, and photos, to continue in another environment.

On import, every Ed25519 signature and every photo SHA-256 hash is verified.

There is no account server and no content server.

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
