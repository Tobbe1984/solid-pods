// background.js  (Service Worker, type: module)
// -----------------------------------------------------------------------------
// Pollt periodisch die Inbox und feuert eine Notification, sobald ein neues
// Dokument vom Behoerden-Gateway zugestellt wurde.
//
// Das ist der "Briefkasten meldet sich"-Moment, der die Demo lebendig macht:
//   Gateway PUT -> neue Ressource im Pod -> Extension erkennt sie -> Notification.
// -----------------------------------------------------------------------------

import { listInbox, inboxFromWebId } from "./pod.js";
import { getSession } from "./auth.js";

const SEEN_KEY = "seen_message_ids";
const POLL_ALARM = "inbox-poll";
const POLL_MINUTES = 0.5; // 30s; fuer die Live-Demo schoen kurz

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) await checkInbox();
});

// Manuell aus dem Popup ausloesbar (z.B. Button "Jetzt pruefen")
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CHECK_NOW") {
    checkInbox()
      .then((n) => sendResponse({ newCount: n }))
      .catch((e) => sendResponse({ error: e.message }));
    return true; // async
  }
});

async function checkInbox() {
  const session = await getSession();
  if (!session) return 0;

  let messages;
  try {
    messages = await listInbox();
  } catch (e) {
    console.warn("Inbox-Poll fehlgeschlagen:", e.message);
    return 0;
  }

  const store = await chrome.storage.local.get(SEEN_KEY);
  const seen = new Set(store[SEEN_KEY] || []);

  const fresh = messages.filter((m) => m.id && !seen.has(m.id));
  for (const m of fresh) {
    notify(m);
    seen.add(m.id);
  }

  await chrome.storage.local.set({ [SEEN_KEY]: [...seen] });

  // Badge mit Anzahl ungelesener Nachrichten
  chrome.action.setBadgeText({
    text: fresh.length ? String(messages.length) : "",
  });
  chrome.action.setBadgeBackgroundColor({ color: "#2d7ff9" });

  return fresh.length;
}

function notify(message) {
  const sender = (message.sender || "Eine Behoerde").replace(
    /^https?:\/\//,
    ""
  );
  chrome.notifications.create(message.id, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Neues Behoerden-Dokument",
    message: `Zustellung von ${sender}`,
    priority: 2,
  });
}
