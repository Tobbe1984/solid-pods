// popup.js
import { login, logout, getSession } from "./auth.js";
import { listInbox } from "./pod.js";

const $ = (id) => document.getElementById(id);

const loginView = $("login-view");
const inboxView = $("inbox-view");

async function render() {
  const session = await getSession();
  if (session) {
    loginView.classList.add("hidden");
    inboxView.classList.remove("hidden");
    $("webid").textContent = session.webId;
    await loadInbox();
  } else {
    loginView.classList.remove("hidden");
    inboxView.classList.add("hidden");
  }
}

async function loadInbox() {
  const list = $("list");
  list.innerHTML = '<div class="empty">Lade…</div>';
  try {
    const messages = await listInbox();
    $("count").textContent = `Eingang · ${messages.length}`;
    if (!messages.length) {
      list.innerHTML = '<div class="empty">Noch keine Dokumente.</div>';
      return;
    }
    list.innerHTML = "";
    for (const m of messages) {
      const div = document.createElement("div");
      div.className = "msg";
      const sender = (m.sender || "Behörde").replace(/^https?:\/\//, "");
      const date = m.sentAt ? new Date(m.sentAt).toLocaleString("de-CH") : "";
      div.innerHTML = `
        <div class="from">${sender}
          ${m.encrypted ? '<span class="badge">verschlüsselt</span>' : ""}
        </div>
        <div class="meta">${date} · ${m.mimeType || ""}</div>`;
      list.appendChild(div);
    }
  } catch (e) {
    list.innerHTML = `<div class="empty">Fehler: ${e.message}</div>`;
  }
}

$("login-btn").addEventListener("click", async () => {
  try {
    await login($("issuer").value.trim());
    await render();
  } catch (e) {
    alert("Login fehlgeschlagen: " + e.message);
  }
});

// E-ID Button: im Prototyp derselbe Flow, nur anders gelabelt (Vertrauensanker-Story)
$("eid-btn").addEventListener("click", () => $("login-btn").click());

$("logout-btn").addEventListener("click", async () => {
  await logout();
  await render();
});

$("refresh-btn").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "CHECK_NOW" }, () => loadInbox());
});

render();
