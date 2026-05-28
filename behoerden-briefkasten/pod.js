// pod.js
// -----------------------------------------------------------------------------
// Generic Solid LDP container listing + convenience methods per use-case.
// -----------------------------------------------------------------------------

import { podFetch, getSession } from './auth.js';

// ── URL Helpers ───────────────────────────────────────────────────────────────

/**
 * Derives the Pod base URL from a WebID.
 * e.g. http://localhost:3000/alice/profile/card#me → http://localhost:3000/alice
 */
export function podBaseFromWebId(webId) {
  return webId.split('/profile/')[0];
}

/**
 * Builds the URL for a named category folder inside the Pod.
 * e.g. category = 'finance' → http://localhost:3000/alice/finance/
 */
export function categoryFolderUrl(webId, category) {
  return `${podBaseFromWebId(webId)}/${category}/`;
}

// ── Generic Container Listing ─────────────────────────────────────────────────

/**
 * Lists all resources inside a Solid LDP container.
 * Parses both JSON envelopes (Behörden-Briefkasten format) and raw binary files.
 *
 * @param {string} containerUrl - Must end with /
 * @returns {Promise<Array>}    - Sorted array of resource metadata objects
 */
export async function listFolder(containerUrl) {
  const res = await podFetch(containerUrl, {
    headers: { Accept: 'application/ld+json' }
  });
  if (!res.ok) throw new Error('Container-Listing fehlgeschlagen: ' + res.status);

  const graph = await res.json();

  // Resolve ldp:contains — robust against various JSON-LD shapes
  const nodes = Array.isArray(graph) ? graph : (graph['@graph'] || [graph]);
  const containerNode =
    nodes.find(n => (n['@id'] || '').replace(/#.*$/, '') === containerUrl) ||
    nodes.find(n => n['ldp:contains'] || n['http://www.w3.org/ns/ldp#contains']);

  let contained = [];
  if (containerNode) {
    const raw =
      containerNode['ldp:contains'] ||
      containerNode['http://www.w3.org/ns/ldp#contains'] || [];
    const arr = Array.isArray(raw) ? raw : [raw];
    contained = arr
      .map(c => (typeof c === 'string' ? c : c['@id']))
      .filter(Boolean);
  }

  const urls = contained.map(u =>
    u.startsWith('http') ? u : containerUrl + u
  );

  const items = await Promise.all(urls.map(url => fetchResourceMetadata(url)));
  const validItems = items.filter(Boolean);

  return validItems.sort((a, b) =>
    (b.sentAt || '').localeCompare(a.sentAt || '')
  );
}

/**
 * Fetches metadata for a single Pod resource.
 * Returns null when the resource is unreadable or a sub-container.
 */
async function fetchResourceMetadata(url) {
  // Skip sub-containers (trailing slash = container)
  if (url.endsWith('/')) return null;

  try {
    const r = await podFetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;

    const contentType = r.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const env = await r.json();
      return {
        url,
        id:        env.id || url,
        sender:    env.sender,
        sentAt:    env.sentAt,
        mimeType:  env.originalMimeType || 'JSON',
        subject:   env.subject,
        filename:  env.filename || url.split('/').pop(),
        encrypted: !!env.ciphertext,
      };
    }

    // Non-JSON binary/text resource — derive metadata from URL + content-type
    const filename = decodeURIComponent(url.split('/').pop());
    const ext = filename.includes('.')
      ? filename.split('.').pop().toUpperCase()
      : contentType.split('/').pop().toUpperCase();

    return {
      url,
      id:       url,
      filename,
      mimeType: ext,
    };
  } catch (_) {
    return null;
  }
}

// ── Convenience Methods ───────────────────────────────────────────────────────

/**
 * Lists the authenticated user's Pod inbox.
 */
export async function listInbox() {
  const session = await getSession();
  if (!session) throw new Error('Nicht eingeloggt');
  return listFolder(`${podBaseFromWebId(session.webId)}/inbox/`);
}

/**
 * Lists all files inside a named category folder (e.g. 'finance', 'health').
 */
export async function listByCategory(category) {
  const session = await getSession();
  if (!session) throw new Error('Nicht eingeloggt');
  return listFolder(categoryFolderUrl(session.webId, category));
}
