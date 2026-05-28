// popup.js
import { login, logout, getSession } from '../auth.js';
import { listInbox } from '../pod.js';

const DISPLAY_NAME_KEY = 'display_name';

// ── DOM Helpers ───────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── View Router ───────────────────────────────────────────────────────────────

async function render() {
  const session = await getSession();
  if (session) {
    await showInbox(session);
  } else {
    showLogin();
  }
}

function showLogin() {
  $('view-login').classList.remove('hidden');
  $('view-inbox').classList.add('hidden');
  $('display-name').textContent = '–';
  $('pod-subtitle').textContent = '';
}

async function showInbox(session) {
  $('view-login').classList.add('hidden');
  $('view-inbox').classList.remove('hidden');

  // Resolve display name: stored name > derived from WebID
  const store = await chrome.storage.local.get(DISPLAY_NAME_KEY);
  const name = store[DISPLAY_NAME_KEY]
    || deriveNameFromWebId(session.webId)
    || 'Nutzer';

  $('display-name').textContent = name;

  // Pod subtitle
  try {
    const host = new URL(session.webId).hostname;
    $('pod-subtitle').innerHTML = `Du bist verbunden mit<br><span>${host}</span>`;
  } catch (_) { /* invalid WebID URL — skip subtitle */ }

  await loadInbox();
}

// ── Inbox ─────────────────────────────────────────────────────────────────────

async function loadInbox() {
  const list = $('activity-list');
  list.innerHTML = '<div class="loading">Lade…</div>';

  try {
    const messages = await listInbox();
    const seenIds = await getSeenIds();
    renderActivityList(messages, seenIds);
  } catch (e) {
    list.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
  }
}

async function getSeenIds() {
  const store = await chrome.storage.local.get('seen_message_ids');
  return new Set(store['seen_message_ids'] || []);
}

function renderActivityList(messages, seenIds) {
  const list = $('activity-list');

  if (!messages.length) {
    list.innerHTML = '<div class="empty-state">Noch keine Dokumente.</div>';
    return;
  }

  list.innerHTML = '';

  for (const msg of messages) {
    const isSeen = msg.id && seenIds.has(msg.id);
    const domain = stripProtocol(msg.sender || 'Unbekannte Behörde');
    const date = formatDate(msg.sentAt);
    const badgeClass = getBadgeClass(msg.mimeType);
    const badgeLabel = msg.mimeType || 'FILE';
    const subject = msg.subject || msg.filename || 'Dokument';

    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div class="item-header">
        <span class="item-domain">${escapeHtml(domain)}</span>
        <span class="item-date">${escapeHtml(date)}</span>
      </div>
      <div class="item-body">
        <span class="${isSeen ? 'icon-seen' : 'icon-new'}">${isSeen ? '👁' : '+'}</span>
        <span class="item-subject" title="${escapeHtml(subject)}">${escapeHtml(subject)}</span>
        <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      </div>
    `;

    list.appendChild(item);
  }
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function setupDropZone() {
  const zone = $('drop-zone');
  if (!zone) return;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    // TODO: handle dropped files → upload to Pod
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      zone.querySelector('span').textContent = `${files.length} Datei(en) empfangen…`;
    }
  });
}

// ── Event Listeners ───────────────────────────────────────────────────────────

$('btn-connect').addEventListener('click', async () => {
  const nameInput = $('input-name').value.trim();
  const issuerInput = $('input-webid').value.trim();

  if (!issuerInput) {
    alert('Bitte eine Web ID oder Pod-URL eingeben.');
    return;
  }

  const btn = $('btn-connect');
  btn.textContent = 'Verbinde…';
  btn.disabled = true;

  try {
    await login(issuerInput);

    if (nameInput) {
      await chrome.storage.local.set({ [DISPLAY_NAME_KEY]: nameInput });
    }

    await render();
  } catch (e) {
    alert('Login fehlgeschlagen: ' + e.message);
  } finally {
    btn.textContent = 'Verbinden';
    btn.disabled = false;
  }
});

// Live header name preview while typing
$('input-name').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  $('display-name').textContent = val || '–';
});

$('btn-logout').addEventListener('click', async () => {
  await logout();
  await chrome.storage.local.remove(DISPLAY_NAME_KEY);
  await render();
});

$('btn-refresh').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CHECK_NOW' }, () => loadInbox());
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function deriveNameFromWebId(webId) {
  try {
    // http://localhost:3000/alice/profile/card#me → "alice"
    const parts = new URL(webId).pathname.split('/').filter(Boolean);
    const name = parts[0] || '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch (_) {
    return '';
  }
}

function stripProtocol(url) {
  return url.replace(/^https?:\/\//, '');
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString('de-CH', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return isoString;
  }
}

function getBadgeClass(mimeType) {
  if (!mimeType) return '';
  const t = mimeType.toLowerCase();
  if (t.includes('pdf'))  return 'pdf';
  if (t.includes('csv'))  return 'csv';
  if (t.includes('json')) return 'json';
  return '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

setupDropZone();
render();
