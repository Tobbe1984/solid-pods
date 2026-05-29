# Behörden-Briefkasten — Chrome Extension + Solid Pod Demo

> **GovTech Hackathon · MVP**  
> A decentralised identity and data-sharing platform built on [Solid](https://solidproject.org/) — citizens own their data; third parties must ask permission before reading or writing.

---

## What it does

**Behörden-Briefkasten** ("Government Letterbox") is a Manifest V3 Chrome Extension that mediates all access to a citizen's Solid Pod. It supports two consent flows:

1. **Read consent (TaxMe → reads Alice's financial data)**  
   TaxMe sends a `DATA_REQUEST`. The extension shows a permission dialog. Alice approves — the extension writes a WAC ACL granting TaxMe read access. TaxMe then fetches the files with its own session token.

2. **Write consent (Bank → writes account data into Alice's Pod)**  
   The bank sends a `DATA_RETRIEVE`. The extension shows a consent screen listing relevant Pod files. Alice approves — the extension writes a WAC ACL granting the bank read+write access and returns the container URL. The bank then writes its data (bekb.json, postfinance.json) directly into Alice's Pod using its own token.

All access grants are:
- **Short-lived** — 7 days TTL stored in chrome.storage.local
- **Scoped** — per category container (e.g. `alice/bekb/`)
- **User-controlled** — the citizen can deny at any time via the extension popup

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Chrome Extension (MV3 — behoerden-briefkasten/)                     │
│                                                                     │
│  background.js ──── handles DATA_REQUEST, DATA_RETRIEVE messages   │
│  permission/        ── read consent dialog (TaxMe reads)           │
│  write/             ── write consent dialog (Bank writes)          │
│  pod.js             ── WAC ACL builder + Solid LDP helpers         │
│  auth.js            ── Solid-OIDC login, authenticated fetch       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ chrome.runtime.sendMessage
          ┌────────────────┴──────────────────┐
          │                                   │
┌─────────▼────────┐               ┌──────────▼──────────┐
│ taxme-mock/      │               │ Bank (BEKB component)│
│ Angular App      │               │ bekb.ts             │
│ taxme.ts         │               │ sends DATA_RETRIEVE  │
│ sends DATA_      │               │ polls GET_APPROVAL   │
│ REQUEST, polls   │               │ writes files to Pod  │
│ GET_APPROVAL     │               └─────────────────────┘
│ reads from Pod   │
└─────────────────┘
           │ WAC ACL + HTTP
           ▼
┌─────────────────────────────┐
│ Community Solid Server      │
│ http://localhost:3000       │
│                             │
│  alice/bekb/                │ ← bank writes here
│  alice/bekb/.acl            │ ← extension updates this
│  alice/profile/card#me      │ ← alice's WebID
│  bank/profile/card#me       │ ← bank's WebID
│  taxme/profile/card#me      │ ← TaxMe's WebID
└─────────────────────────────┘
```

### Permission flow detail

**Write flow (Bank → Alice's Pod):**
1. User (Alice) clicks "Kontodaten in Pod schreiben" on the bank page
2. Bank's Angular component sends `DATA_RETRIEVE` to the extension
3. Extension opens `write/permission.html` — shows files found in the relevant Pod folder
4. Alice clicks "Schreiben zulassen"
5. Extension calls `grantAccess({ requesterWebId: bank, category: 'bekb', accessMode: 'Read, Write' })`
6. `grantAccess` PUTs a WAC ACL at `alice/bekb/.acl` granting the bank read+write
7. Extension stores `{ approved: true, containerUrl: 'http://localhost:3000/alice/bekb/' }` in `chrome.storage.local`
8. Bank polls `GET_APPROVAL` — receives the result
9. Bank uses its own Solid session token to PUT `bekb.json` and `postfinance.json` into the container

**Read flow (TaxMe reads Alice's financial data):**
1. Alice clicks "Daten aus Solid Pod laden" in TaxMe
2. TaxMe sends `DATA_REQUEST` to the extension
3. Extension opens `permission/permission.html`
4. Alice approves — extension calls `grantAccess({ requesterWebId: taxme, category: 'bekb', accessMode: 'Read' })`
5. Extension stores approval result with `containerUrl`
6. TaxMe polls `GET_APPROVAL` — fetches files from the container using its own session

---

## Quick Start

### 1. Start the Solid Pod Server

From the project root:

```bash
cd taxme-mock
npx community-solid-server -c @css:config/file.json -f ../data --baseUrl http://localhost:3000/
```

The `data/` directory already contains pre-configured accounts and pods for `alice`, `bank`, and `taxme`.

### 2. Load the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"** → select the `behoerden-briefkasten/` folder
4. Note the **Extension ID** and update `taxme-mock/environment.ts` if it differs:
   ```ts
   EXTENSION_ID: 'your-extension-id-here',
   ```

### 3. Start the Angular App

```bash
cd taxme-mock
npm install
npm run start
```

Open `http://localhost:4200` in Chrome.

### 4. Set up accounts (first time only)

Run the setup script (accounts likely already exist in `data/`):

```bash
bash setup-auth.sh alice123
```

This creates the CSS accounts and writes client credentials to `taxme-mock/.env`. The ACL is **not** pre-set — the extension sets it dynamically when the user grants access.

---

## End-to-End Test (Manual)

### Write flow (Bank writes account data)

1. Open `http://localhost:4200/bekb`
2. Click **"Mit Solid Pod einloggen"** and authenticate as Alice
3. Click **"Kontodaten in Pod schreiben"**
4. The extension opens a consent popup — verify the file list and click **"Schreiben zulassen"**
5. Status changes to "Kontodaten geschrieben ✓"
6. Verify: `curl -s http://localhost:3000/alice/bekb/bekb.json -H "Authorization: Bearer <alice-token>"`

### Read flow (TaxMe reads financial data)

1. Open `http://localhost:4200`
2. Click **"Mit Solid Pod einloggen"** and authenticate as Alice (or TaxMe)
3. Click **"Daten aus Solid Pod laden"**
4. The extension opens a consent popup — click **"Erlauben"**
5. TaxMe displays the financial data

---

## curl Happy-Path Test

Get tokens:
```bash
# TaxMe token (credentials from taxme-mock/.env)
TAXME_TOKEN=$(curl -s -X POST http://localhost:3000/.oidc/token \
  -u "taxme-app-<id>:<secret>" \
  -d "grant_type=client_credentials&scope=webid" | jq -r .access_token)

# Bank token (from setup-auth output)
BANK_TOKEN=$(curl -s -X POST http://localhost:3000/.oidc/token \
  -u "bank-app-<id>:<secret>" \
  -d "grant_type=client_credentials&scope=webid" | jq -r .access_token)

# Alice token
ALICE_TOKEN=$(curl -s -X POST http://localhost:3000/.oidc/token \
  -u "alice-setup-<id>:<secret>" \
  -d "grant_type=client_credentials&scope=webid" | jq -r .access_token)
```

Test flow:
```bash
# Before grant: both get 403
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/alice/bekb/ -H "Authorization: Bearer $BANK_TOKEN"  # 403
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/alice/bekb/ -H "Authorization: Bearer $TAXME_TOKEN" # 403

# Alice grants bank write access (simulates extension approve button)
curl -X PUT http://localhost:3000/alice/bekb/.acl \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: text/turtle" \
  --data-binary @- << 'EOF'
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner>
    a acl:Authorization ; acl:agent <http://localhost:3000/alice/profile/card#me> ;
    acl:accessTo <./> ; acl:default <./> ; acl:mode acl:Read, acl:Write, acl:Control .
<#bank-write>
    a acl:Authorization ; acl:agent <http://localhost:3000/bank/profile/card#me> ;
    acl:accessTo <./> ; acl:default <./> ; acl:mode acl:Read, acl:Write .
EOF

# Bank writes
curl -X PUT http://localhost:3000/alice/bekb/bekb.json \
  -H "Authorization: Bearer $BANK_TOKEN" -H "Content-Type: application/json" \
  -d '{"account":"BEKB","balance":12345.67}'                        # 201/205

# Alice grants TaxMe read access
# (add <#taxme-read> block to the ACL)

# TaxMe reads
curl http://localhost:3000/alice/bekb/bekb.json -H "Authorization: Bearer $TAXME_TOKEN" # 200
```

---

## Project Structure

```
solid-pods/
├── behoerden-briefkasten/        Chrome Extension (MV3)
│   ├── manifest.json
│   ├── auth.js                   Solid-OIDC login + DPoP-ready fetch
│   ├── pod.js                    LDP helpers + WAC ACL builder (grantAccess)
│   ├── background.js             Service Worker — message routing, polling
│   ├── permission/               Read consent dialog
│   │   ├── permission.html
│   │   └── permission.js
│   └── write/                    Write consent dialog (NEW)
│       ├── permission.html
│       └── permission.js
├── taxme-mock/                   Angular 17 mock app
│   ├── src/app/components/
│   │   ├── taxme/                Read flow — requests DATA_REQUEST
│   │   └── bekb/                 Write flow — requests DATA_RETRIEVE
│   ├── src/app/services/
│   │   └── solid-pod-extension.service.ts
│   └── environment.ts            EXTENSION_ID, SOLID_OIDC_ISSUER, etc.
├── data/                         CSS file backend (pods + accounts)
│   ├── alice/                    Alice's Solid Pod
│   ├── bank/                     Bank's Solid Pod
│   └── taxme/                    TaxMe's Solid Pod
├── setup-auth.sh                 Account + credential bootstrap script
└── docker-compose.yml            Docker-based CSS setup (alternative)
```

---

## Key Design Decisions

| Topic | Decision | Reason |
|---|---|---|
| Auth | Custom Solid-OIDC (no Inrupt browser lib) | Inrupt's lib requires `window.location` redirects — breaks in MV3 Service Worker |
| ACL writes | Extension writes WAC ACL on approve | Only the citizen (logged into the extension) can modify their own Pod's ACL |
| ACL preservation | `fetchExistingAclGrants` reads existing ACL before rewriting | Prevents overwriting previously approved grants when a new request comes in |
| Consent TTL | 7 days, stored in `chrome.storage.local` | Short enough for security, long enough for the hackathon demo |
| Write mode | Bank uses own session token (not Alice's) | Bank is the authenticated writer; Alice's token is only used for ACL updates |
| Token type | Bearer (MVP) | CSS accepts Bearer for client_credentials; DPoP upgrade hook is in `auth.js` |

---

## WAC ACL Format

The extension generates ACL documents in this format:

```turtle
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:agent <http://localhost:3000/alice/profile/card#me> ;
    acl:accessTo <./> ;
    acl:default <./> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#grant-0>
    a acl:Authorization ;
    acl:agent <http://localhost:3000/bank/profile/card#me> ;
    acl:accessTo <./> ;
    acl:default <./> ;
    acl:mode acl:Read, acl:Write .
```

`acl:default <./>` ensures that the grants apply to all resources within the container (not just the container itself).

---

## Roadmap / Production Hardening

- [ ] **DPoP** — per-request signed JWTs (hook in `auth.js`)
- [ ] **Token refresh** — silent renewal via `refresh_token`
- [ ] **Grant revocation UI** — popup to view and revoke active grants
- [ ] **Encryption** — `ciphertext` envelope field reserved in pod.js
- [ ] **swiyu E-ID** — Swiss E-ID trust anchor instead of prototype button
- [ ] **Grant expiry enforcement** — check `expiresAt` before allowing read/write

---

## License

MIT — built during a GovTech Hackathon. Contributions welcome.
