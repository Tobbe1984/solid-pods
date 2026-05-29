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

// ── Access Control (WAC) ──────────────────────────────────────────────────────

const ACL_GRANTS_KEY = 'acl_grants';

/**
 * Grants a requester access to a Pod container via WAC ACL.
 * The container is derived from request.category. Alice (session owner) always
 * keeps full control. All previously granted entries are preserved.
 *
 * @param {object} request - The pending DATA_REQUEST object from storage.
 *   Must contain: requesterWebId, category, accessMode ('Read' | 'Read, Write')
 * @returns {Promise<string>} - The containerUrl that was granted access to
 */
export async function grantAccess(request) {
  const session = await getSession();
  if (!session) throw new Error('Nicht eingeloggt');
  if (!request.requesterWebId) throw new Error('requesterWebId fehlt in der Anfrage');

  const podBase      = podBaseFromWebId(session.webId);
  const containerUrl = `${podBase}/${request.category.toLowerCase()}/`;

  // Ensure the container exists
  await podFetch(containerUrl, {
    method:  'PUT',
    headers: {
      'Content-Type': 'text/turtle',
      'Link':         '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
    },
    body: ''
  });

  // Load grants stored by this extension (user-approved)
  const store     = await chrome.storage.local.get(ACL_GRANTS_KEY);
  const allGrants = store[ACL_GRANTS_KEY] || {};
  const grants    = allGrants[containerUrl] || [];

  // Upsert the new grant (replace existing entry for same WebID)
  const idx = grants.findIndex(g => g.webId === request.requesterWebId);
  const newGrant = {
    webId:     request.requesterWebId,
    mode:      request.accessMode || 'Read',
    label:     request.domain,
    grantedAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  if (idx >= 0) {
    grants[idx] = newGrant;
  } else {
    grants.push(newGrant);
  }

  // Merge with any grants already on the pod ACL (e.g. write-access set by setup-auth.sh)
  const existingGrants = await fetchExistingAclGrants(containerUrl + '.acl');
  for (const eg of existingGrants) {
    if (!grants.some(g => g.webId === eg.webId)) {
      grants.push(eg);
    }
  }

  // Build and PUT the ACL
  const aclTurtle = buildAclTurtle(session.webId, grants);
  const aclRes    = await podFetch(containerUrl + '.acl', {
    method:  'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body:    aclTurtle
  });
  if (!aclRes.ok) throw new Error(`ACL setzen fehlgeschlagen: ${aclRes.status}`);

  // Persist updated grants
  allGrants[containerUrl] = grants;
  await chrome.storage.local.set({ [ACL_GRANTS_KEY]: allGrants });

  return containerUrl;
}

/**
 * Fetches an existing ACL and extracts non-owner agent grants so they can be
 * preserved when rewriting the ACL.
 */
async function fetchExistingAclGrants(aclUrl) {
  try {
    const res = await podFetch(aclUrl, { headers: { Accept: 'text/turtle' } });
    if (!res.ok) return [];
    const turtle = await res.text();

    const grants = [];
    // Split on lines that start a new <#block>
    const blocks = turtle.split(/(?=^<#)/m);

    for (const block of blocks) {
      if (!block.includes('acl:Authorization')) continue;

      const agentM = block.match(/acl:agent\s+<([^>]+)>/);
      if (!agentM) continue;
      const webId = agentM[1];

      // Skip owner block (has acl:Control)
      if (block.includes('acl:Control')) continue;

      // Extract all modes from the acl:mode line(s), e.g. "acl:Read, acl:Write"
      const modeLineM = block.match(/acl:mode\s+((?:acl:\w+[,\s]*)+)/);
      const modeStr = modeLineM
        ? [...modeLineM[1].matchAll(/acl:(\w+)/g)].map(m => m[1]).join(', ')
        : 'Read';

      grants.push({ webId, mode: modeStr, label: webId, grantedAt: 0, expiresAt: 0 });
    }
    return grants;
  } catch (_) {
    return [];
  }
}

/**
 * Builds a WAC ACL Turtle document for a container.
 * The owner always receives Read/Write/Control; additional grants are appended.
 */
function buildAclTurtle(ownerWebId, grants) {
  const lines = ['@prefix acl: <http://www.w3.org/ns/auth/acl#> .', ''];

  lines.push(
    '<#owner>',
    '    a acl:Authorization ;',
    `    acl:agent <${ownerWebId}> ;`,
    '    acl:accessTo <./> ;',
    '    acl:default <./> ;',
    '    acl:mode acl:Read, acl:Write, acl:Control .',
    ''
  );

  grants.forEach((grant, i) => {
    // mode may be 'Read' or 'Read, Write' — prefix each token with acl: if not already
    const modeStr = grant.mode
      .split(',')
      .map(m => { const t = m.trim(); return t.startsWith('acl:') ? t : `acl:${t}`; })
      .join(', ');
    lines.push(
      `<#grant-${i}>`,
      '    a acl:Authorization ;',
      `    acl:agent <${grant.webId}> ;`,
      '    acl:accessTo <./> ;',
      '    acl:default <./> ;',
      `    acl:mode ${modeStr} .`,
      ''
    );
  });

  return lines.join('\n');
}
