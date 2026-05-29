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
 * Lists all files inside a named category folder (e.g. 'bekb', 'taxme').
 */
export async function listByCategory(category) {
  const session = await getSession();
  if (!session) throw new Error('Nicht eingeloggt');
  return listFolder(categoryFolderUrl(session.webId, category));
}

/**
 * Lists files across multiple category folders in parallel and merges results.
 * Folders that don't exist yet are silently skipped.
 *
 * @param {string[]} categories - e.g. ['bekb', 'taxme', 'inbox']
 * @returns {Promise<Array>}    - merged + date-sorted array
 */
export async function listCategories(categories) {
  const session = await getSession();
  if (!session) throw new Error('Nicht eingeloggt');

  const base = podBaseFromWebId(session.webId);
  const results = await Promise.allSettled(
    categories.map(cat => listFolder(`${base}/${cat}/`))
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => (b.sentAt || b.filename || '').localeCompare(a.sentAt || a.filename || ''));
}

// ── Write Operations ──────────────────────────────────────────────────────────

/**
 * Ensures a container (folder) exists on the Pod.
 * Creates it if it doesn't exist yet; a 412 / 409 / 200 are all treated as OK.
 *
 * @param {string} folderUrl - Must end with /
 */
export async function ensureFolder(folderUrl) {
  const res = await podFetch(folderUrl, {
    method:  'PUT',
    headers: {
      'Content-Type': 'text/turtle',
      'Link':         '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    body: '',
  });
  // 201 = created, 200/204 = already exists — both are fine
  if (!res.ok && res.status !== 409 && res.status !== 412) {
    throw new Error(`Ordner konnte nicht erstellt werden: ${res.status}`);
  }
}

/**
 * Uploads a File object to the given Pod folder.
 * Creates the folder first if it doesn't exist.
 *
 * @param {string} folderUrl - Target folder URL (must end with /)
 * @param {File}   file      - Browser File object from an <input type="file">
 * @returns {Promise<string>} - URL of the uploaded resource
 */
export async function uploadFile(folderUrl, file) {
  await ensureFolder(folderUrl);

  const fileUrl = folderUrl + encodeURIComponent(file.name);
  const res = await podFetch(fileUrl, {
    method:  'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body:    file,
  });

  if (!res.ok) throw new Error(`Upload fehlgeschlagen: ${res.status}`);
  return fileUrl;
}
