// auth.js
// -----------------------------------------------------------------------------
// Solid-OIDC Login fuer eine Manifest-V3 Extension via chrome.identity.
//
// Warum manuell und nicht @inrupt/solid-client-authn-browser?
//   Die Inrupt-Browser-Library erwartet window.location-Redirects und laeuft
//   nicht sauber im Service Worker. Wir bauen daher den Authorization-Code-Flow
//   mit PKCE selbst auf launchWebAuthFlow auf. Das ist der von Chrome
//   dokumentierte Weg fuer Nicht-Google-OAuth-Provider.
//
// Hinweis DPoP: Der Community Solid Server akzeptiert fuer den Authorization
//   Code Flow auch Bearer-Tokens (DPoP ist nicht zwingend, wenn der Client
//   keine DPoP-bound Tokens anfordert). Fuer den MVP nutzen wir Bearer.
//   Fuer Produktion ist DPoP nachzuruesten (siehe Kommentar unten).
// -----------------------------------------------------------------------------

const STORAGE_KEY = "solid_session";

// PKCE-Helfer ---------------------------------------------------------------
function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(verifier) {
  const data = new TextEncoder().encode(verifier);
  return crypto.subtle.digest("SHA-256", data);
}

function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr).slice(0, len);
}

// OIDC Discovery ------------------------------------------------------------
async function discover(issuer) {
  const url = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const res = await fetch(url);
  if (!res.ok) throw new Error("OIDC Discovery fehlgeschlagen: " + res.status);
  return res.json();
}

// Dynamic Client Registration ----------------------------------------------
// Solid-OIDC erlaubt dynamische Registrierung; so brauchen wir keine
// vorab konfigurierte client_id beim CSS.
async function registerClient(registrationEndpoint, redirectUri) {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Behoerden-Briefkasten",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid offline_access webid",
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok)
    throw new Error("Client-Registrierung fehlgeschlagen: " + res.status);
  return res.json();
}

// Haupt-Login ---------------------------------------------------------------
export async function login(issuer) {
  const redirectUri = chrome.identity.getRedirectURL("callback");
  const meta = await discover(issuer);
  const client = await registerClient(meta.registration_endpoint, redirectUri);

  const codeVerifier = randomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = randomString(32);

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid offline_access webid");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const returned = new URL(responseUrl);
  if (returned.searchParams.get("state") !== state) {
    throw new Error("State stimmt nicht ueberein (moeglicher CSRF)");
  }
  const code = returned.searchParams.get("code");
  if (!code) throw new Error("Kein Authorization Code erhalten");

  // Token-Tausch
  const tokenRes = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok)
    throw new Error("Token-Tausch fehlgeschlagen: " + tokenRes.status);
  const tokens = await tokenRes.json();

  // WebID aus dem ID-Token lesen
  const idClaims = JSON.parse(atob(tokens.id_token.split(".")[1]));
  const webId = idClaims.webid || idClaims.sub;

  const session = {
    issuer,
    webId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type || "Bearer",
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    tokenEndpoint: meta.token_endpoint,
    clientId: client.client_id,
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
  return session;
}

export async function getSession() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || null;
}

export async function logout() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// Authentifizierter fetch gegen den Pod -------------------------------------
export async function podFetch(url, options = {}) {
  const session = await getSession();
  if (!session) throw new Error("Nicht eingeloggt");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `${session.tokenType} ${session.accessToken}`);
  // Produktion: hier zusaetzlich DPoP-Header mit pro-Request signiertem JWT setzen.
  return fetch(url, { ...options, headers });
}
