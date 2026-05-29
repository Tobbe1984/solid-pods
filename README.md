# Behörden-Briefkasten — Chrome Extension

> **GovTech Hackathon · MVP**  
> A decentralised government mailbox built on [Solid](https://solidproject.org/) — your official documents live in your own Pod, not on a government server.

---

## What it does

**Behörden-Briefkasten** ("Government Letterbox") is a Manifest V3 Chrome Extension that gives citizens a single, privacy-preserving inbox for official government documents. Instead of storing letters on a centralised government platform, each document is delivered directly into the citizen's personal **Solid Pod**. The extension then:

- authenticates the user via **Solid-OIDC** (Authorization Code Flow + PKCE, Dynamic Client Registration — no pre-configured `client_id` required),
- lists all documents stored in the Pod's `behoerden-briefkasten/` inbox container,
- **polls the inbox every 30 seconds** in the background and fires a **desktop notification** the moment a new document arrives.

The trust anchor for login is an **E-ID** (prototype flow; production target: [swiyu](https://www.swiyu.admin.ch/)).

---

## Architecture

```
Chrome Extension (MV3)
│
├── auth.js          Solid-OIDC login, token management, authenticated fetch
├── pod.js           LDP container listing + JSON envelope parsing
├── background.js    Service Worker — alarm-based polling, notifications, badge
├── popup.html/js    360 px popup UI — login view & inbox list
└── manifest.json    Permissions: identity, storage, alarms, notifications, offscreen
```

**Auth flow in detail:**
1. `chrome.identity.launchWebAuthFlow` opens the Solid Provider login page.
2. The extension performs **Dynamic Client Registration** on first login — it registers itself at the CSS `registration_endpoint` automatically.
3. After the Authorization Code exchange the access token is stored in `chrome.storage.local`.
4. Every authenticated request sends a `Bearer` token. A `DPoP` header upgrade (per-request signed JWT) is marked in `auth.js` for the production path.

**Notification flow:**
```
Gateway PUT → new resource in Pod → background.js polls → new ID detected → Desktop Notification
```

---

## Project Structure

```
behoerden-briefkasten/
├── manifest.json
├── auth.js
├── pod.js
├── background.js
├── popup.html
├── popup.js
└── icon128.png        ← you need to add this (128×128 px)
```

---

## Prerequisites

- **Google Chrome** or **Microsoft Edge** (Chromium-based)
- A running **Community Solid Server (CSS)** — default URL `http://localhost:3000`
- Node.js (only needed to run the CSS locally)

### Install the Community Solid Server

```bash
npx @solid/community-server -p 3000
```

Or with a custom config (recommended for CORS tweaks):

```bash
npx @solid/community-server -p 3000 -c @css:config/file.json
```

---

## Installation

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"** and select the `behoerden-briefkasten/` folder
4. Note the **Extension ID** shown on the tile (you'll need it for CORS if issues arise)

### 2. Create a Solid Pod for the test user

1. Open `http://localhost:3000/.account/` in your browser and create an account for e.g. `alice`.
2. Create a pod for e.g. `alice`

### 3. Log in via the extension

1. Click the extension icon in Chrome's toolbar
2. The default issuer `http://localhost:3000` is pre-filled — adjust if your CSS runs elsewhere
3. Click **Login** (or **Mit E-ID anmelden** for the trust-anchor demo path)
4. Complete the Solid-OIDC consent screen in the popup window
5. On success the popup switches to the inbox view showing your WebID

---

## CORS Configuration

The extension origin is `chrome-extension://<EXTENSION-ID>`. Most CSS setups reflect the `Origin` header automatically, so CORS works out of the box.

If login or inbox listing fails with a CORS error, start CSS with a relaxed CORS config:

```bash
npx @solid/community-server -p 3000 -c @css:config/file.json \
  --corsOrigin="*"
```

The OIDC redirect URI used by the extension is:

```
https://<EXTENSION-ID>.chromiumapp.org/callback
```

Because Dynamic Client Registration is used, this URI is registered automatically on first login — no manual setup needed on the server side.

---

## End-to-End Test

1. Start the CSS: `npx @solid/community-server -p 3000`
2. Create an `alice` account at `http://localhost:3000/.account/`
3. Load the extension and log in
4. Deliver a document via the government gateway:
   ```http
   POST http://localhost:3000/api/behoerde/zustellen
   ```
5. Within ~30 seconds a desktop notification **"Neues Behörden-Dokument"** appears and the popup inbox list updates automatically

You can also click **Aktualisieren** in the popup to trigger an immediate check.

---

## Key Design Decisions

| Topic | Decision | Reason |
|---|---|---|
| Auth library | Custom (no `@inrupt/solid-client-authn-browser`) | Inrupt's browser library relies on `window.location` redirects, which don't work in an MV3 Service Worker |
| Token type | Bearer (MVP) | CSS accepts Bearer tokens for the Auth Code flow; DPoP upgrade is marked in `auth.js` |
| Client registration | Dynamic (RFC 7591) | No pre-configured `client_id` needed — zero server-side setup for the demo |
| Polling interval | 30 s (`POLL_MINUTES = 0.5`) | Short enough to feel live during a hackathon demo; increase for production |
| Storage format | JSON envelopes (`.json` files in LDP container) | Simple to produce from the gateway, easy to extend with encryption (`ciphertext` field already parsed) |

---

## Roadmap / Production Hardening

- [ ] **DPoP** — replace Bearer with per-request signed JWTs (hook already in `auth.js`)
- [ ] **Token refresh** — use `refresh_token` to silently renew expired access tokens
- [ ] **End-to-end encryption** — the `ciphertext` envelope field is reserved; add key management via the Pod
- [ ] **swiyu E-ID** — wire the real Swiss E-ID trust anchor instead of the prototype button
- [ ] **Unread tracking** — persist read/unread state per message ID
- [ ] **Document download** — open/download the original file (PDF, etc.) from the Pod resource URL

---

## License

MIT — built during a GovTech Hackathon. Contributions welcome.
