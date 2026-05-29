// popup.js
import { login, logout, getSession } from "../auth.js";
import {
  listByCategory,
  listCategories,
  uploadFile,
  podBaseFromWebId,
} from "../pod.js";
import { getSiteContext, ALL_CATEGORIES } from "../shared/site-config.js";

const DISPLAY_NAME_KEY = "display_name";

// ── State ─────────────────────────────────────────────────────────────────────

let currentSiteContext = null; // { category, label } | null
let showAllMode = false; // false = current site filter, true = all folders

// ── DOM Helpers ───────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function setDisplayName(name) {
  const el = $("display-name-greeting");
  el.innerHTML = name ? `, <strong>${name}</strong>` : "";
}

function setDisplayName(name) {
  const el = $("display-name-greeting");
  el.innerHTML = name ? `, <strong>${name}</strong>` : "";
}

// ── Initialise ────────────────────────────────────────────────────────────────

async function render() {
  const session = await getSession();
  if (session) {
    await showInbox(session);
  } else {
    showLogin();
  }
}

function showLogin() {
  $("view-login").classList.remove("hidden");
  $("view-inbox").classList.add("hidden");
  setDisplayName("");
  $("pod-subtitle").textContent = "";
}

async function showInbox(session) {
  $("view-login").classList.add("hidden");
  $("view-inbox").classList.remove("hidden");

  // Detect which site the user is currently browsing
  currentSiteContext = await detectActiveTabContext();

  // Default: show current site's folder if known, otherwise show all
  showAllMode = currentSiteContext === null;

  // Resolve display name
  const store = await chrome.storage.local.get(DISPLAY_NAME_KEY);
  const name =
    store[DISPLAY_NAME_KEY] || deriveNameFromWebId(session.webId) || "Nutzer";

  setDisplayName(name);

  try {
    const host = new URL(session.webId).hostname;
    $(
      "pod-subtitle"
    ).innerHTML = `Du bist verbunden mit<br><span>${host}</span>`;
  } catch (_) {
    /* skip */
  }

  updateFilterUI();
  await loadFiles();
}

// ── File Loading ──────────────────────────────────────────────────────────────

async function loadFiles() {
  const list = $("activity-list");
  list.innerHTML = '<div class="loading">Lade…</div>';

  try {
    let files;
    if (showAllMode || !currentSiteContext) {
      files = await listCategories(ALL_CATEGORIES);
    } else {
      files = await listByCategory(currentSiteContext.category);
    }
    const seenIds = await getSeenIds();
    renderFileList(files, seenIds);
  } catch (e) {
    list.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
  }
}

function renderFileList(files, seenIds) {
  const list = $("activity-list");

  if (!files.length) {
    const folderHint =
      !showAllMode && currentSiteContext
        ? ` in /${currentSiteContext.category}`
        : "";
    list.innerHTML = `<div class="empty-state">Keine Dateien${folderHint}.</div>`;
    return;
  }

  list.innerHTML = "";

  for (const file of files) {
    const isSeen = file.id && seenIds.has(file.id);
    const domain = file.sender
      ? stripProtocol(file.sender)
      : folderFromUrl(file.url);
    const date = formatDate(file.sentAt);
    const badgeClass = getBadgeClass(file.mimeType);
    const badgeLabel = file.mimeType || "FILE";
    const subject = file.subject || file.filename || "Dokument";

    const item = document.createElement("div");
    item.className = "activity-item";
    item.innerHTML = `
      <div class="item-header">
        <span class="item-domain">${escapeHtml(domain)}</span>
        <span class="item-date">${escapeHtml(date)}</span>
      </div>
      <div class="item-body">
        <span class="${isSeen ? "icon-seen" : "icon-new"}">${
      isSeen ? "👁" : "+"
    }</span>
        <span class="item-subject" title="${escapeHtml(subject)}">${escapeHtml(
      subject
    )}</span>
        <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      </div>
    `;
    list.appendChild(item);
  }
}

// ── Filter UI ─────────────────────────────────────────────────────────────────

function updateFilterUI() {
  const siteBtn = $("btn-filter-site");
  const allBtn = $("btn-filter-all");
  const filterLbl = $("filter-label");
  const uploadLbl = $("upload-target-label");

  if (currentSiteContext) {
    // Known site — show site name in label
    filterLbl.innerHTML = showAllMode
      ? "Alle Dateien"
      : `Dateien von <strong>${currentSiteContext.label}</strong>`;

    siteBtn.textContent = currentSiteContext.label;
    siteBtn.style.display = "";

    uploadLbl.innerHTML = `Upload → <span>/${
      showAllMode ? "inbox" : currentSiteContext.category
    }</span>`;
  } else {
    // Unknown site — always show all, hide "Diese Seite" button
    filterLbl.innerHTML = "Alle Dateien";
    siteBtn.style.display = "none";
    uploadLbl.innerHTML = `Upload → <span>/inbox</span>`;
  }

  siteBtn.classList.toggle("active", !showAllMode);
  allBtn.classList.toggle("active", showAllMode);
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function handleUpload(files) {
  if (!files.length) return;

  const session = await getSession();
  if (!session) {
    showToast("Nicht eingeloggt.", true);
    return;
  }

  // Determine target folder
  const category =
    !showAllMode && currentSiteContext ? currentSiteContext.category : "inbox";
  const folderUrl = `${podBaseFromWebId(session.webId)}/${category}/`;

  const btn = $("btn-upload");
  btn.classList.add("uploading");
  btn.textContent = "↑ Lädt…";

  let successCount = 0;
  const errors = [];

  for (const file of Array.from(files)) {
    try {
      await uploadFile(folderUrl, file);
      successCount++;
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  btn.classList.remove("uploading");
  btn.textContent = "↑ Hochladen";

  if (errors.length) {
    showToast(
      `${successCount} hochgeladen, ${errors.length} Fehler: ${errors[0]}`,
      true
    );
  } else {
    showToast(
      `✓ ${successCount} Datei${
        successCount !== 1 ? "en" : ""
      } hochgeladen nach /${category}`,
      false
    );
  }

  // Refresh list
  await loadFiles();
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function setupDropZone() {
  const zone = $("drop-zone");

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    await handleUpload(e.dataTransfer.files);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, isError) {
  const toast = $("upload-toast");
  toast.textContent = message;
  toast.className = `upload-toast ${isError ? "err" : "ok"}`;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

// ── Event Listeners ───────────────────────────────────────────────────────────

$("btn-connect").addEventListener("click", async () => {
  const nameInput = $("input-name").value.trim();
  const issuerInput = $("input-webid").value.trim();

  if (!issuerInput) {
    alert("Bitte eine Web ID oder Pod-URL eingeben.");
    return;
  }

  const btn = $("btn-connect");
  btn.textContent = "Verbinde…";
  btn.disabled = true;

  try {
    await login(issuerInput);
    if (nameInput)
      await chrome.storage.local.set({ [DISPLAY_NAME_KEY]: nameInput });
    await render();
  } catch (e) {
    alert("Login fehlgeschlagen: " + e.message);
  } finally {
    btn.textContent = "Verbinden";
    btn.disabled = false;
  }
});

$("input-name").addEventListener("input", (e) => {
  const val = e.target.value.trim();
  setDisplayName(val);
});

$("btn-logout").addEventListener("click", async () => {
  await logout();
  await chrome.storage.local.remove(DISPLAY_NAME_KEY);
  await render();
});

$("btn-refresh").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CHECK_NOW" }, () => loadFiles());
});

$("btn-filter-site").addEventListener("click", async () => {
  if (showAllMode) {
    showAllMode = false;
    updateFilterUI();
    await loadFiles();
  }
});

$("btn-filter-all").addEventListener("click", async () => {
  if (!showAllMode) {
    showAllMode = true;
    updateFilterUI();
    await loadFiles();
  }
});

$("btn-upload").addEventListener("click", () => {
  $("file-input").click();
});

$("file-input").addEventListener("change", async (e) => {
  await handleUpload(e.target.files);
  e.target.value = ""; // reset so same file can be re-selected
});

// ── Utils ─────────────────────────────────────────────────────────────────────

async function detectActiveTabContext() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      resolve(url ? getSiteContext(url) : null);
    });
  });
}

async function getSeenIds() {
  const store = await chrome.storage.local.get("seen_message_ids");
  return new Set(store["seen_message_ids"] || []);
}

function deriveNameFromWebId(webId) {
  try {
    const parts = new URL(webId).pathname.split("/").filter(Boolean);
    const name = parts[0] || "";
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch (_) {
    return "";
  }
}

function folderFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    // second-to-last segment is usually the folder name
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "–";
  } catch (_) {
    return "–";
  }
}

function stripProtocol(url) {
  return url.replace(/^https?:\/\//, "");
}

function formatDate(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleString("de-CH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return isoString;
  }
}

function getBadgeClass(mimeType) {
  if (!mimeType) return "";
  const t = mimeType.toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("csv")) return "csv";
  if (t.includes("json")) return "json";
  return "";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────────

setupDropZone();
render();
