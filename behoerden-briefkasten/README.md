# Behörden-Briefkasten — Chrome Extension

> Manifest V3 · Solid-OIDC · Decentralised government mailbox

---

## Folder Structure

```
behoerden-briefkasten/
├── manifest.json               MV3 config, permissions, externally_connectable
├── auth.js                     Solid-OIDC login (PKCE + Dynamic Client Registration)
├── pod.js                      Solid LDP container listing (generic + convenience)
├── background.js               Service Worker — polling, notifications, event handling
├── icon128.png                 Extension icon (128×128, add manually)
├── test-trigger.html           Local test page to fire DATA_REQUEST events
│
├── shared/
│   └── theme.css               Design system — colours, wave header, cards, badges
│
├── popup/
│   ├── popup.html              Extension popup (Login view + Inbox view)
│   └── popup.js                Popup logic — login, inbox rendering, drop zone
│
└── permission/
    ├── permission.html         Permission dialog (Requesting view + Confirm view)
    └── permission.js           Loads pending request, lists Pod files, approve/deny
```

---

## Installation

### 1. Prerequisites

- Chrome or any Chromium-based browser
- [Community Solid Server (CSS)](https://github.com/CommunitySolidServer/CommunitySolidServer) running locally

```bash
npx @solid/community-server -p 3000
```

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `behoerden-briefkasten/` folder
4. Note the **Extension ID** shown on the tile

### 3. Create a Solid Pod

Open `http://localhost:3000/.account/` and register an account (e.g. `alice`).

### 4. Connect

Click the extension icon → enter your Pod URL (e.g. `http://localhost:3000`) → **Verbinden**.

---

## Pages & Views

### Popup (`popup/popup.html`)

| View | Shown when |
|---|---|
| **Login** | No active session — enter optional display name + Pod/Issuer URL |
| **Inbox** | Active session — lists all documents from `/inbox/` with seen/new indicators |

The display name entered at login is persisted in `chrome.storage.local` and shown in the header on every subsequent open. If left empty, the name is derived from the WebID path (e.g. `alice`).

---

### Permission Dialog (`permission/permission.html`)

Opened automatically as a popup window (420×700 px) when a `DATA_REQUEST` event arrives.

| View | Shown when |
|---|---|
| **Requesting** | Dialog just opened — spinner while searching the Pod |
| **Confirm** | Files found — lists up to 4 files from the requested category folder |
| **Error** | No active session or no pending request found |

After the user decides, the result is stored in `chrome.storage.local` under the key `approval_result` for the requesting website to read.

---

## Events

### Internal Events (within the extension)

Sent via `chrome.runtime.sendMessage({ type })` — no extension ID needed.

| Type | Sender | Description |
|---|---|---|
| `CHECK_NOW` | `popup.js` (refresh button) | Triggers an immediate inbox poll; background responds with `{ newCount: n }` |
| `DATA_REQUEST` | Any extension page (dev shortcut) | Same as external DATA_REQUEST — opens the permission dialog |

**Example — trigger inbox refresh from popup DevTools:**
```javascript
chrome.runtime.sendMessage(
  { type: 'CHECK_NOW' },
  (response) => console.log('New messages:', response.newCount)
);
```

**Example — trigger permission dialog from popup DevTools (dev only):**
```javascript
chrome.runtime.sendMessage(
  {
    type:        'DATA_REQUEST',
    description: 'Kontoauszüge des Jahres 2025 für Zwick, David',
    category:    'finance',
    requestId:   'test-001'
  },
  (response) => console.log(response)
);
```

---

### External Events (from websites)

Sent via `chrome.runtime.sendMessage(EXTENSION_ID, message, callback)` from any web page
whose origin matches `externally_connectable.matches` in `manifest.json`
(currently: `http://localhost/*` and `https://*/*`).

---

#### `DATA_REQUEST`

Asks the user to grant a website temporary read access to a category of Pod files.
The background script stores the request, opens the permission dialog, and returns immediately.

**Payload:**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"DATA_REQUEST"` | ✅ | Event type identifier |
| `description` | `string` | ✅ | Human-readable description shown in the dialog |
| `category` | `string` | ✅ | Pod folder name to search (e.g. `finance`, `health`, `inbox`) |
| `requestId` | `string` | — | Optional correlation ID; auto-generated if omitted |
| `domain` | `string` | — | Override display domain; defaults to `sender.origin` |

**Response (synchronous):**

```json
{ "status": "opening", "requestId": "test-001" }
```

**Approval result** — poll `chrome.storage.local` for key `approval_result`:

```json
{
  "requestId": "test-001",
  "domain":    "fin.be.ch",
  "category":  "finance",
  "approved":  true,
  "expiresAt": 1748000000000
}
```

```json
{
  "requestId": "test-001",
  "domain":    "fin.be.ch",
  "approved":  false,
  "deniedAt":  1748000000000
}
```

**Full example from an external website:**

```javascript
const EXTENSION_ID = 'idifkehjjoonchbajgfhehlojmijiplj'; // from chrome://extensions

chrome.runtime.sendMessage(
  EXTENSION_ID,
  {
    type:        'DATA_REQUEST',
    description: 'Kontoauszüge des Jahres 2025 für Zwick, David',
    category:    'finance',
    requestId:   'req-' + crypto.randomUUID()
  },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }
    console.log('Dialog opened:', response);

    // Poll for the user's decision
    pollApproval(response.requestId);
  }
);

function pollApproval(requestId, maxAttempts = 60) {
  let attempts = 0;
  const interval = setInterval(() => {
    chrome.storage.local.get('approval_result', ({ approval_result }) => {
      if (approval_result?.requestId === requestId) {
        clearInterval(interval);
        if (approval_result.approved) {
          console.log('✅ Access granted until', new Date(approval_result.expiresAt));
        } else {
          console.log('❌ Access denied');
        }
      }
      if (++attempts >= maxAttempts) clearInterval(interval);
    });
  }, 1000);
}
```

---

### Background Alarms (internal, no payload)

| Alarm name | Interval | Effect |
|---|---|---|
| `inbox-poll` | every 30 s | Fetches `/inbox/`, fires desktop notification for each new document, updates badge count |

---

## Testing

### Option A — Test page (recommended)

Serve `test-trigger.html` over HTTP and open it in Chrome:

```bash
cd behoerden-briefkasten
python3 -m http.server 8080
# open http://localhost:8080/test-trigger.html
```

Enter your Extension ID, fill in description + category, click the button.

### Option B — Browser Console (external)

Open any `http://localhost:*` page, then in DevTools Console:

```javascript
chrome.runtime.sendMessage('YOUR_EXTENSION_ID', {
  type: 'DATA_REQUEST', description: 'Test', category: 'finance'
}, console.log);
```

### Option C — Extension Popup Console (internal, dev only)

Open the extension popup → right-click → Inspect → Console:

```javascript
chrome.runtime.sendMessage({
  type: 'DATA_REQUEST', description: 'Test', category: 'finance'
}, console.log);
```

---

## Storage Keys

All data lives in `chrome.storage.local`.

| Key | Written by | Content |
|---|---|---|
| `solid_session` | `auth.js` | OIDC session (tokens, WebID, expiry) |
| `display_name` | `popup.js` | Optional display name entered at login |
| `seen_message_ids` | `background.js` | Set of already-notified message IDs |
| `pending_data_request` | `background.js` | Active DATA_REQUEST waiting for user decision |
| `approval_result` | `permission.js` | Last approve/deny decision (read by requesting website) |

---

## Architecture Notes

- **Auth:** Manual Authorization Code + PKCE flow via `chrome.identity.launchWebAuthFlow`. Dynamic Client Registration means no `client_id` needs to be pre-configured on the server.
- **Token type:** Bearer (MVP). DPoP upgrade point marked in `auth.js`.
- **External messaging:** `chrome.runtime.onMessageExternal` responds synchronously then does async work — avoids the MV3 Service Worker "port closed" issue.
- **Pod listing:** `pod.js → listFolder(url)` is a generic LDP container reader; `listInbox()` and `listByCategory(cat)` are thin convenience wrappers on top.
