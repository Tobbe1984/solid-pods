// pod.js
// -----------------------------------------------------------------------------
// Liest den Inbox-Container des Pods und parst die Behoerden-Nachrichten.
//
// CSS v7 liefert Container-Listings als JSON-LD in einem flachen Array:
// Container-Node und Member-Nodes liegen nebeneinander, NICHT als
// ldp:contains-Eigenschaft eines einzelnen Nodes. Deshalb filtern wir
// direkt alle @id-Werte heraus, die innerhalb der Inbox liegen.
// -----------------------------------------------------------------------------

import { podFetch, getSession } from "./auth.js";

// Aus der WebID den Inbox-Container ableiten.
// WebID:  http://localhost:3000/alice/profile/card#me
// Inbox:  http://localhost:3000/alice/inbox/
export function inboxFromWebId(webId) {
  const base = webId.split("/profile/")[0];
  return `${base}/inbox/`;
}

// Container-Mitglieder auflisten.
export async function listInbox() {
  const session = await getSession();
  if (!session) throw new Error("Nicht eingeloggt");
  const inbox = inboxFromWebId(session.webId);

  const res = await podFetch(inbox, {
    headers: { Accept: "application/ld+json" },
  });
  if (!res.ok) throw new Error("Inbox-Listing fehlgeschlagen: " + res.status);
  const graph = await res.json();

  // CSS v7: flaches Array von Nodes — Container + Members gemischt.
  // Wir filtern alle Nodes heraus, die NICHT der Container selbst sind.
  const nodes = Array.isArray(graph) ? graph : graph["@graph"] || [graph];

  const urls = nodes
    .map((n) => n["@id"] || "")
    .filter(
      (id) =>
        id.startsWith(inbox) && // liegt in der Inbox
        id !== inbox && // ist nicht der Container selbst
        id !== inbox.slice(0, -1) // auch nicht ohne trailing slash
    )
    .filter((u) => u.endsWith(".json"));

  const messages = [];
  for (const url of urls) {
    try {
      const r = await podFetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) continue;
      const env = await r.json();
      messages.push({
        url,
        id: env.id,
        sender: env.sender,
        sentAt: env.sentAt,
        mimeType: env.originalMimeType,
        encrypted: !!env.ciphertext,
      });
    } catch (_) {
      /* einzelne defekte Ressource ignorieren */
    }
  }

  return messages.sort((a, b) =>
    (b.sentAt || "").localeCompare(a.sentAt || "")
  );
}
