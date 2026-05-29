// permission.js
//
// Handles the two-step permission dialog:
//   1. REQUESTING — show the request, spinner while searching Pod
//   2. CONFIRM    — show found files, allow approve / deny
//
// The pending request is written to chrome.storage.local by background.js
// before this window is opened.

import { getSession } from '../auth.js';
import { listByCategory, listFolder, podBaseFromWebId, grantAccess } from '../pod.js';

const PENDING_REQUEST_KEY = 'pending_data_request';
const APPROVAL_KEY        = 'approval_result';
const MAX_VISIBLE_FILES   =  4;

// ── DOM Helpers ───────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  const [sessionStore, requestStore] = await Promise.all([
    getSession(),
    chrome.storage.local.get(PENDING_REQUEST_KEY)
  ]);

  const session = sessionStore;
  const request = requestStore[PENDING_REQUEST_KEY];

  if (!session) {
    showError('Du bist nicht eingeloggt. Bitte zuerst mit deinem Pod verbinden.');
    return;
  }

  if (!request) {
    showError('Keine ausstehende Anfrage gefunden.');
    return;
  }

  // Populate header
  const name = await resolveDisplayName(session);
  $('display-name').textContent = name;
  try {
    const host = new URL(session.webId).hostname;
    $('pod-subtitle').innerHTML = `Du bist verbunden mit<br><span>${host}</span>`;
  } catch (_) { /* skip */ }

  // Show requesting view while we search
  showRequesting(request);

  // Search the Pod
  const files = await searchPodFiles(session, request);

  // Show confirm view with results
  showConfirm(request, files);
}

// ── Views ─────────────────────────────────────────────────────────────────────

function showRequesting(request) {
  hideAll();
  $('view-requesting').classList.remove('hidden');
  $('req-domain').textContent      = request.domain;
  $('req-description').textContent = request.description || '';
}

function showConfirm(request, files) {
  hideAll();
  $('view-confirm').classList.remove('hidden');
  $('conf-domain').textContent      = request.domain;
  $('conf-description').textContent = request.description || '';
  $('found-count').textContent      = files.length;
  renderFileList(files);
}

function showError(message) {
  hideAll();
  $('view-error').classList.remove('hidden');
  $('error-text').textContent = message;
}

function hideAll() {
  ['view-requesting', 'view-confirm', 'view-error'].forEach(id => {
    $(id).classList.add('hidden');
  });
}

// ── File List Rendering ───────────────────────────────────────────────────────

function renderFileList(files) {
  const list   = $('file-list');
  const more   = $('more-files');
  const visible = files.slice(0, MAX_VISIBLE_FILES);
  const hidden  = files.length - visible.length;

  list.innerHTML = '';

  for (const file of visible) {
    const ext        = resolveExtension(file);
    const badgeClass = getBadgeClass(ext);
    const filename   = shortenFilename(file.filename || file.url.split('/').pop(), 24);
    const label      = file.subject || file.sender || '';

    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `
      <span class="badge ${badgeClass}">${escapeHtml(ext)}</span>
      <span class="file-name" title="${escapeHtml(file.filename || '')}">${escapeHtml(filename)}</span>
      <span class="file-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
    `;
    list.appendChild(row);
  }

  if (hidden > 0) {
    more.textContent = `… ${hidden} weitere Datei${hidden === 1 ? '' : 'en'}`;
    more.classList.remove('hidden');
  } else {
    more.classList.add('hidden');
  }
}

// ── Pod Search ────────────────────────────────────────────────────────────────

async function searchPodFiles(session, request) {
  try {
    if (request.category) {
      return await listByCategory(request.category);
    }
    // Fallback: list the full Pod inbox
    const inboxUrl = `${podBaseFromWebId(session.webId)}/inbox/`;
    return await listFolder(inboxUrl);
  } catch (e) {
    console.warn('Pod-Suche fehlgeschlagen:', e.message);
    return [];
  }
}

// ── Approval / Denial ─────────────────────────────────────────────────────────

async function approve(request) {
  // Disable buttons and show spinner while ACL is being written
  $('btn-approve').disabled = true;
  $('btn-deny').disabled    = true;
  $('btn-approve').textContent = 'Wird freigegeben …';

  try {
    await grantAccess(request);
  } catch (e) {
    showError(`Freigabe fehlgeschlagen: ${e.message}`);
    return;
  }

  const result = {
    requestId: request.id,
    domain:    request.domain,
    category:  request.category,
    approved:  true,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  await chrome.storage.local.set({ [APPROVAL_KEY]: result });
  await chrome.storage.local.remove(PENDING_REQUEST_KEY);
  window.close();
}

async function deny(request) {
  const result = {
    requestId: request.id,
    domain:    request.domain,
    approved:  false,
    deniedAt:  Date.now()
  };
  await chrome.storage.local.set({ [APPROVAL_KEY]: result });
  await chrome.storage.local.remove(PENDING_REQUEST_KEY);
  window.close();
}

// ── Event Listeners ───────────────────────────────────────────────────────────

async function attachListeners() {
  const store   = await chrome.storage.local.get(PENDING_REQUEST_KEY);
  const request = store[PENDING_REQUEST_KEY];

  $('btn-deny-loading').addEventListener('click', () => deny(request || {}));
  $('btn-deny').addEventListener('click',         () => deny(request || {}));
  $('btn-approve').addEventListener('click',      () => approve(request || {}));
  $('btn-close-error').addEventListener('click',  () => window.close());
}

// ── Utils ─────────────────────────────────────────────────────────────────────

async function resolveDisplayName(session) {
  const store = await chrome.storage.local.get('display_name');
  if (store['display_name']) return store['display_name'];
  try {
    const parts = new URL(session.webId).pathname.split('/').filter(Boolean);
    const name  = parts[0] || '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch (_) {
    return 'Nutzer';
  }
}

function resolveExtension(file) {
  if (file.mimeType) return file.mimeType.toUpperCase().split('/').pop();
  const name = file.filename || file.url || '';
  const ext  = name.split('.').pop();
  return ext ? ext.toUpperCase() : 'FILE';
}

function getBadgeClass(ext) {
  if (!ext) return '';
  const t = ext.toLowerCase();
  if (t === 'pdf')  return 'pdf';
  if (t === 'csv')  return 'csv';
  if (t === 'json') return 'json';
  return '';
}

function shortenFilename(name, maxLen) {
  if (!name || name.length <= maxLen) return name;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  return name.slice(0, maxLen - ext.length - 1) + '…' + ext;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

attachListeners();
init();
