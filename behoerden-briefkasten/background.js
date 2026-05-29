// background.js  (Service Worker, type: module)
// -----------------------------------------------------------------------------
// Responsibilities:
//   1. Periodic inbox polling + desktop notifications
//   2. Handling external DATA_REQUEST messages from websites
//   3. Opening the permission dialog window
// -----------------------------------------------------------------------------

import { listFolder, podBaseFromWebId } from './pod.js';
import { getSession, login } from './auth.js';

const SEEN_KEY            = 'seen_message_ids';
const POLL_ALARM          = 'inbox-poll';
const POLL_MINUTES        = 0.5;            // 30 s — short for demo, increase for production
export const PENDING_REQUEST_KEY = 'pending_data_request';

// ── Alarm Setup ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) await checkInbox();
});

// ── Internal Messages (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── LOGIN ──────────────────────────────────────────────────────────────────
  // Running login() in the Service Worker instead of the popup fixes the MV3
  // focus-loss bug: Chrome closes the popup as soon as launchWebAuthFlow opens
  // the auth window, destroying the popup's JS context. The SW is kept alive
  // by the ongoing chrome.identity call and completes the full OIDC flow.
  if (msg?.type === 'LOGIN') {
    // Acknowledge immediately so the popup can update its UI before closing.
    sendResponse({ status: 'started' });

    login(msg.issuer)
      .then(() => {
        // Session is in chrome.storage.local — popup will find it on next open.
        // Also broadcast completion in case the popup is still alive (desktop).
        chrome.runtime.sendMessage({ type: 'LOGIN_COMPLETE' }).catch(() => {});
        chrome.storage.local.remove('login_error');
      })
      .catch(e => {
        chrome.storage.local.set({ login_error: e.message });
        chrome.runtime.sendMessage({ type: 'LOGIN_ERROR', error: e.message }).catch(() => {});
      });

    return false; // already responded synchronously
  }

  if (msg?.type === 'CHECK_NOW') {
    checkInbox()
      .then(n => sendResponse({ newCount: n }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  // DEV SHORTCUT: handle DATA_REQUEST internally for testing from popup DevTools.
  if (msg?.type === 'DATA_REQUEST') {
    const requestId = msg.requestId || crypto.randomUUID();
    sendResponse({ status: 'opening', requestId });
    handleDataRequest(msg, sender, requestId).catch(console.error);
    return false;
  }
});

// ── External Messages (from websites via externally_connectable) ──────────────
//
// Any website listed in manifest "externally_connectable.matches" can call:
//
//   chrome.runtime.sendMessage(EXTENSION_ID, {
//     type:        'DATA_REQUEST',
//     description: 'Kontoauszüge des Jahres 2025 für Zwick, David',
//     category:    'finance',    // folder name inside the Pod
//     requestId:   'req-abc123'  // optional correlation ID
//   }, (response) => console.log(response));
//
// The extension opens a permission dialog; the result is stored under
// APPROVAL_KEY in chrome.storage.local for the website to poll.

chrome.runtime.onMessageExternal.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type === 'DATA_REQUEST') {
    // Respond synchronously — MV3 Service Workers go to sleep before an async
    // response can be sent, causing "message port closed" errors.
    const requestId = msg.requestId || crypto.randomUUID();
    const session = await getSession();
    sendResponse({status: 'opening', requestId, session, files: [
        'http://localhost:3000/timfrey/bekb.json',
        'http://localhost:3000/timfrey/postfinance.json',
      ]});

    // Fire-and-forget: async work happens after the port is already closed
    handleDataRequest(msg, sender, requestId).catch(console.error);

    return false; // port already closed intentionally
  }
});

async function handleDataRequest(msg, sender, requestId) {
  const { description, category } = msg;

  // sender.origin can be null/undefined when triggered from DevTools console
  let domain = msg.domain || 'unknown';
  try {
    const originStr = sender.origin || sender.url;
    if (originStr && originStr !== 'null') {
      domain = new URL(originStr).hostname;
    }
  } catch (_) { /* keep fallback domain */ }

  const request = {
    id:          requestId,
    domain,
    description: description || '',
    category:    category || 'inbox',
    origin:      sender.origin || sender.url || '',
    timestamp:   Date.now()
  };

  await chrome.storage.local.set({ [PENDING_REQUEST_KEY]: request });

  chrome.windows.create({
    url:     chrome.runtime.getURL('permission/permission.html'),
    type:    'popup',
    width:   420,
    height:  700,
    focused: true
  });

  return { status: 'opening', requestId: request.id };
}

// ── Inbox Polling ─────────────────────────────────────────────────────────────

async function checkInbox() {
  const session = await getSession();
  if (!session) return 0;

  const inboxUrl = `${podBaseFromWebId(session.webId)}/inbox/`;

  let messages;
  try {
    messages = await listFolder(inboxUrl);
  } catch (e) {
    console.warn('Inbox-Poll fehlgeschlagen:', e.message);
    return 0;
  }

  const store = await chrome.storage.local.get(SEEN_KEY);
  const seen  = new Set(store[SEEN_KEY] || []);

  const fresh = messages.filter(m => m.id && !seen.has(m.id));
  for (const m of fresh) {
    sendNotification(m);
    seen.add(m.id);
  }

  await chrome.storage.local.set({ [SEEN_KEY]: [...seen] });

  // Update badge with total unread count
  const badgeText = messages.length ? String(messages.length) : '';
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#3DD4CE' });

  return fresh.length;
}

function sendNotification(message) {
  const sender = (message.sender || 'Eine Behörde').replace(/^https?:\/\//, '');
  chrome.notifications.create(message.id, {
    type:     'basic',
    iconUrl:  'icon128.png',
    title:    'Neues Behörden-Dokument',
    message:  `Zustellung von ${sender}`,
    priority: 2
  });
}
