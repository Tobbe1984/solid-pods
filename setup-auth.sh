#!/usr/bin/env bash
# Richtet WAC-Auth für den Hackathon ein:
#   - alice (Bürger)   → vollen Zugriff auf eigenen Briefkasten
#   - taxme-mock       → Read auf alice/behoerden-briefkasten/
#   - bank-mock        → Write auf alice/behoerden-briefkasten/
# Voraussetzung: CSS läuft auf http://localhost:3000 (docker compose up)
set -euo pipefail

CSS_URL="http://localhost:3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/taxme-mock/.env"

# Alice-Passwort: erstes CLI-Argument oder interaktive Abfrage
ALICE_PASSWORD="${1:-}"
if [[ -z "$ALICE_PASSWORD" ]]; then
  read -rsp "▸ Passwort für alice@example.com: " ALICE_PASSWORD
  echo ""
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}▸${NC} $*" >&2; }
warn() { echo -e "${YELLOW}⚠${NC} $*" >&2; }
ok()   { echo -e "${GREEN}✓${NC} $*" >&2; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ---------- CSS bereitschaft ----------

wait_for_css() {
  log "Warte auf CSS ($CSS_URL)..."
  for i in $(seq 1 30); do
    if curl -sf "$CSS_URL" > /dev/null 2>&1; then
      ok "CSS ist bereit."; return 0
    fi
    sleep 1
  done
  fail "CSS nicht erreichbar nach 30s. Ist 'docker compose up' gestartet?"
}

# ---------- Account-Verwaltung (CSS 7 Account API) ----------

# Erstellt einen neuen Account + Password-Login + Pod.
# Gibt bei Erfolg den CSS-Account-Token zurück.
# Gibt bei bereits existierendem Account "" zurück (→ ensure_account loggt dann ein).
create_account() {
  local email=$1 password=$2 podname=$3

  # Schritt 1: Leeren Account erstellen
  local resp; resp=$(curl -sf -X POST "$CSS_URL/.account/account/" \
    -H "Content-Type: application/json" 2>/dev/null) || { echo ""; return; }

  local account_url; account_url=$(echo "$resp" | jq -r '.resource // empty')
  local account_auth; account_auth=$(echo "$resp" | jq -r '.authorization // empty')
  [[ -z "$account_url" || -z "$account_auth" ]] && { echo ""; return; }

  # Schritt 2: Email/Passwort-Login hinzufügen
  curl -sf -X POST "$CSS_URL/.account/login/password/" \
    -H "Authorization: $account_auth" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" > /dev/null \
    || { echo ""; return; }

  # Schritt 3: Pod erstellen (endpoint aus account-controls holen)
  local controls; controls=$(curl -sf "$account_url" \
    -H "Authorization: $account_auth" \
    -H "Accept: application/json" 2>/dev/null) || true

  local pod_url; pod_url=$(echo "$controls" | jq -r '.controls.pod.create // empty' 2>/dev/null || echo "")
  if [[ -n "$pod_url" ]]; then
    curl -sf -X POST "$pod_url" \
      -H "Authorization: $account_auth" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$podname\"}" > /dev/null || true
  fi

  echo "$account_auth"
}

# Loggt in einen bestehenden Account ein.
# Gibt CSS-Account-Token und Account-URL zurück (tab-separiert).
login_account() {
  local email=$1 password=$2
  local resp; resp=$(curl -sf -X POST "$CSS_URL/.account/login/password/" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" 2>/dev/null) || { echo ""; return; }

  local auth; auth=$(echo "$resp" | jq -r '.authorization // empty')
  local url;  url=$(echo  "$resp" | jq -r '.account // empty')
  echo "$auth	$url"
}

# Erstellt Account falls nicht vorhanden, loggt sonst ein.
# Gibt "AUTH_TOKEN<tab>ACCOUNT_URL" zurück.
ensure_account() {
  local email=$1 password=$2 podname=$3
  log "Account sicherstellen: $podname ($email)"

  # Erst versuchen einzuloggen
  local login_result; login_result=$(login_account "$email" "$password")
  local auth; auth=$(echo "$login_result" | cut -f1)

  if [[ -n "$auth" ]]; then
    warn "$podname existiert bereits, eingeloggt."
    local url; url=$(echo "$login_result" | cut -f2)
    echo "$auth	$url"
    return
  fi

  # Account neu erstellen
  local account_auth; account_auth=$(create_account "$email" "$password" "$podname")
  [[ -z "$account_auth" ]] && fail "Account-Erstellung für $podname fehlgeschlagen. Falls der Account existiert: falsches Passwort?"

  # Jetzt einloggen um Account-URL zu erhalten
  login_result=$(login_account "$email" "$password")
  auth=$(echo "$login_result" | cut -f1)
  local url; url=$(echo "$login_result" | cut -f2)
  [[ -z "$auth" ]] && fail "Login nach Erstellung für $podname fehlgeschlagen."
  ok "$podname erstellt und eingeloggt."
  echo "$auth	$url"
}

# Erstellt Client Credentials für einen Account.
# Gibt JSON mit id + secret zurück.
create_credentials() {
  local account_url=$1 account_auth=$2 webid=$3 name=$4

  local controls; controls=$(curl -sf "$account_url" \
    -H "Authorization: $account_auth" \
    -H "Accept: application/json") \
    || fail "Account-Controls nicht abrufbar: $account_url"

  # CSS 7 nennt den Key "client-credentials" (mit Bindestrich)
  local cred_url; cred_url=$(echo "$controls" | \
    jq -r '(.controls["client-credentials"].create // .controls.clientCredentials.create // "") | select(. != "")' \
    2>/dev/null || echo "")
  [[ -z "$cred_url" ]] && fail "Kein client-credentials Endpoint in Account-Controls gefunden."

  curl -sf -X POST "$cred_url" \
    -H "Authorization: $account_auth" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"webId\":\"$webid\"}" \
    || fail "Client Credentials für $webid konnten nicht erstellt werden."
}

# Tauscht Client Credentials gegen Bearer Access Token.
get_access_token() {
  local client_id=$1 client_secret=$2
  curl -sf -X POST "$CSS_URL/.oidc/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -u "$client_id:$client_secret" \
    -d "grant_type=client_credentials&scope=webid" \
    || fail "Token-Austausch fehlgeschlagen für client_id=$client_id."
}

# ---------- Hauptablauf ----------

wait_for_css

# 1. Accounts sicherstellen
ALICE_LOGIN=$(ensure_account "alice@example.com" "$ALICE_PASSWORD" "alice")
ALICE_AUTH=$(echo "$ALICE_LOGIN" | cut -f1)
ALICE_ACCOUNT_URL=$(echo "$ALICE_LOGIN" | cut -f2)

TAXME_LOGIN=$(ensure_account "taxme@mock.local" "taxme123" "taxme")
TAXME_AUTH=$(echo "$TAXME_LOGIN" | cut -f1)
TAXME_ACCOUNT_URL=$(echo "$TAXME_LOGIN" | cut -f2)

BANK_LOGIN=$(ensure_account "bank@mock.local" "bank123" "bank")
BANK_AUTH=$(echo "$BANK_LOGIN" | cut -f1)
BANK_ACCOUNT_URL=$(echo "$BANK_LOGIN" | cut -f2)

# 2. Alice: Access Token für Container & ACL-Setup
log "Erstelle Alice Client Credentials..."
ALICE_CREDS=$(create_credentials \
  "$ALICE_ACCOUNT_URL" "$ALICE_AUTH" \
  "http://localhost:3000/alice/profile/card#me" \
  "alice-setup-$(date +%s)")
ALICE_ID=$(echo "$ALICE_CREDS" | jq -r '.id')
ALICE_SECRET=$(echo "$ALICE_CREDS" | jq -r '.secret')
ALICE_TOKEN=$(get_access_token "$ALICE_ID" "$ALICE_SECRET" | jq -r '.access_token')
ok "Alice Access Token erhalten."

# 3. Briefkasten-Container erstellen
log "Erstelle Container: alice/behoerden-briefkasten/"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "$CSS_URL/alice/behoerden-briefkasten/" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: text/turtle" \
  -H 'Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' \
  --data-raw "")
[[ $HTTP_CODE =~ ^(200|201|204|205)$ ]] \
  && ok "Container bereit (HTTP $HTTP_CODE)." \
  || warn "Container-PUT ergab HTTP $HTTP_CODE (evtl. schon vorhanden)."

# 4. (ACL wird nicht mehr per Script gesetzt — die Chrome Extension setzt die ACL
#     dynamisch wenn der Nutzer im Permission-Dialog auf "Erlauben" klickt.)

# 5. TaxMe Client Credentials
log "Erstelle TaxMe Client Credentials..."
TAXME_CREDS=$(create_credentials \
  "$TAXME_ACCOUNT_URL" "$TAXME_AUTH" \
  "http://localhost:3000/taxme/profile/card#me" \
  "taxme-app-$(date +%s)")
TAXME_ID=$(echo "$TAXME_CREDS" | jq -r '.id')
TAXME_SECRET=$(echo "$TAXME_CREDS" | jq -r '.secret')
ok "TaxMe Client Credentials generiert."

# 6. Bank Client Credentials
log "Erstelle Bank Client Credentials..."
BANK_CREDS=$(create_credentials \
  "$BANK_ACCOUNT_URL" "$BANK_AUTH" \
  "http://localhost:3000/bank/profile/card#me" \
  "bank-app-$(date +%s)")
BANK_ID=$(echo "$BANK_CREDS" | jq -r '.id')
BANK_SECRET=$(echo "$BANK_CREDS" | jq -r '.secret')
ok "Bank Client Credentials generiert."

# 7. taxme-mock/.env aktualisieren
log "Schreibe taxme-mock/.env..."
cat > "$ENV_FILE" << EOF
SOLID_CLIENT_ID="$TAXME_ID"
SOLID_CLIENT_SECRET="$TAXME_SECRET"
SOLID_OIDC_ISSUER="http://localhost:3000"
SOLID_RESOURCE_URL="http://localhost:3000/alice/behoerden-briefkasten/"
EOF
ok "taxme-mock/.env aktualisiert."

# ---------- Zusammenfassung ----------

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Auth-Setup erfolgreich abgeschlossen${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}WebIDs${NC}"
echo "    Alice   http://localhost:3000/alice/profile/card#me"
echo "    TaxMe   http://localhost:3000/taxme/profile/card#me"
echo "    Bank    http://localhost:3000/bank/profile/card#me"
echo ""
echo -e "  ${BOLD}ACL${NC}  wird durch die Chrome Extension gesetzt (Allow-Button im Permission-Dialog)"
echo ""
echo -e "  ${BOLD}taxme-mock/.env${NC} wurde aktualisiert."
echo ""
echo -e "  ${BOLD}Bank-Mock Credentials${NC} (für zukünftigen Bank-Service):"
echo "    SOLID_CLIENT_ID=\"$BANK_ID\""
echo "    SOLID_CLIENT_SECRET=\"$BANK_SECRET\""
echo "    SOLID_OIDC_ISSUER=\"http://localhost:3000\""
echo "    SOLID_RESOURCE_URL=\"http://localhost:3000/alice/behoerden-briefkasten/\""
echo ""
