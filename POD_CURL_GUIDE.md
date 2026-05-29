# Solid Pod — curl Cookbook

> How to create containers (folders), upload files, and manage resources in a  
> [Community Solid Server (CSS)](https://github.com/CommunitySolidServer/CommunitySolidServer)  
> using plain `curl` commands.  
> Default base URL used throughout: `http://localhost:3000`

---

## 1. Get an Access Token

Almost every write operation requires a Bearer token. The easiest way to obtain one for local development is via **CSS Client Credentials** (CSS ≥ 6).

### 1a. Create a Pod & Account (if not done yet)

```bash
curl -X POST http://localhost:3000/.account/login/password/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "createWebId": true,
    "webId": "",
    "register": true,
    "createPod": true,
    "podName": "alice",
    "email": "alice@example.com",
    "password": "supersecret"
  }'
```

Expected response: `201 Created` with the new WebID.

---

### 1b. Log in and get a session cookie

```bash
curl -c cookies.txt -X POST http://localhost:3000/.account/login/password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "supersecret"
  }'
```

The session cookie is saved to `cookies.txt`.

---

### 1c. Create Client Credentials

```bash
curl -b cookies.txt -X POST http://localhost:3000/.account/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-token",
    "webId": "http://localhost:3000/alice/profile/card#me"
  }'
```

Response:

```json
{
  "id": "my-client-id",
  "secret": "my-client-secret",
  "webId": "http://localhost:3000/alice/profile/card#me"
}
```

> Save `id` and `secret` — you'll need them below.

---

### 1d. Exchange Credentials for an Access Token

```bash
curl -X POST http://localhost:3000/.oidc/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "my-client-id:my-client-secret" \
  -d "grant_type=client_credentials&scope=webid"
```

Response:

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Store the token in a shell variable for convenience:

```bash
TOKEN="eyJhbGci..."
```

---

## 2. Create a Container (Folder)

Solid uses the [LDP BasicContainer](https://www.w3.org/TR/ldp/#ldpbc) type.  
A container URL **must end with a trailing slash**.

### Create a single container

```bash
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/turtle" \
  -H "Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel=\"type\"" \
  --data-raw ""
```

Expected: `201 Created`

---

### Create nested containers in one go

Solid servers create missing parent containers automatically on PUT:

```bash
curl -X PUT http://localhost:3000/alice/archiv/2025/steuern/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/turtle" \
  -H "Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel=\"type\"" \
  --data-raw ""
```

This creates `archiv/`, `archiv/2025/`, and `archiv/2025/steuern/` if they don't exist yet.

---

### Create a container via POST (server chooses the name)

```bash
curl -X POST http://localhost:3000/alice/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/turtle" \
  -H "Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel=\"type\"" \
  -H "Slug: documents" \
  --data-raw ""
```

The `Slug` header is a hint for the container name; the server may modify it.  
The created URL is returned in the `Location` response header.

---

## 3. Upload a File (Resource)

### Upload a JSON envelope (government document delivery)

```bash
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "doc-001",
    "sender": "https://finanzamt.example.gov",
    "sentAt": "2025-11-01T09:00:00Z",
    "originalMimeType": "application/pdf",
    "subject": "Steuerbescheid 2025",
    "ciphertext": null
  }'
```

Expected: `201 Created`

---

### Upload a PDF

```bash
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.pdf \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/local/steuerbescheid.pdf
```

---

### Upload a plain text file

```bash
curl -X PUT http://localhost:3000/alice/notes/memo.txt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/plain" \
  -d "This is a plain text memo."
```

---

### POST a file (server chooses the name)

```bash
curl -X POST http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Slug: bescheid-nov" \
  -d '{
    "id": "doc-002",
    "sender": "https://kfz-amt.example.gov",
    "sentAt": "2025-11-15T14:30:00Z",
    "originalMimeType": "application/pdf"
  }'
```

The exact URL is returned in `Location`.

---

## 4. Read & List

### List all resources in a container

```bash
curl http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/ld+json"
```

Or as Turtle:

```bash
curl http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/turtle"
```

---

### Read a single file

```bash
curl http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json"
```

---

### Check resource metadata (HEAD)

```bash
curl -I http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN"
```

---

## 5. Update a File

Use `PUT` again — it overwrites the existing resource completely:

```bash
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "doc-001",
    "sender": "https://finanzamt.example.gov",
    "sentAt": "2025-11-01T09:00:00Z",
    "originalMimeType": "application/pdf",
    "subject": "Steuerbescheid 2025 (korrigiert)",
    "ciphertext": null
  }'
```

For partial updates use `PATCH` with `Content-Type: application/sparql-update`:

```bash
curl -X PATCH http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/sparql-update" \
  -d 'INSERT DATA { <> <http://schema.org/name> "Updated title" . }'
```

> Note: SPARQL Update patches work on RDF resources (Turtle, JSON-LD). For plain JSON/binary files, use PUT.

---

## 6. Delete

### Delete a single file

```bash
curl -X DELETE http://localhost:3000/alice/behoerden-briefkasten/steuerbescheid-2025.json \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `205 Reset Content` or `204 No Content`

---

### Delete a container

A container must be **empty** before it can be deleted (CSS behaviour):

```bash
# Delete the file inside first
curl -X DELETE http://localhost:3000/alice/archiv/2025/steuern/doc.json \
  -H "Authorization: Bearer $TOKEN"

# Then delete the container
curl -X DELETE http://localhost:3000/alice/archiv/2025/steuern/ \
  -H "Authorization: Bearer $TOKEN"
```

---

## 7. Access Control (WAC)

Each resource has a companion `.acl` file. To make the inbox **readable by the government gateway** (a specific WebID):

```bash
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/.acl \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/turtle" \
  -d '
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

# Alice has full control
<#owner>
    a acl:Authorization ;
    acl:agent <http://localhost:3000/alice/profile/card#me> ;
    acl:accessTo <./> ;
    acl:default <./> ;
    acl:mode acl:Read, acl:Write, acl:Control .

# Government gateway can write (deliver documents)
<#gateway>
    a acl:Authorization ;
    acl:agent <https://gateway.behoerde.example.gov/profile/card#me> ;
    acl:accessTo <./> ;
    acl:default <./> ;
    acl:mode acl:Write .
'
```

Read the current ACL:

```bash
curl http://localhost:3000/alice/behoerden-briefkasten/.acl \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/turtle"
```

---

## 8. Full Demo: Simulate a Government Delivery

This is the sequence the extension's background poller detects:

```bash
# 1. Ensure the inbox container exists
curl -X PUT http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/turtle" \
  -H "Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel=\"type\"" \
  --data-raw ""

# 2. Deliver a document (simulates the government gateway)
curl -X PUT "http://localhost:3000/alice/behoerden-briefkasten/bescheid-$(date +%s).json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"doc-$(date +%s)\",
    \"sender\": \"https://finanzamt.example.gov\",
    \"sentAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"originalMimeType\": \"application/pdf\",
    \"subject\": \"Steuerbescheid 2025\"
  }"

# 3. Verify it appears in the container listing
curl http://localhost:3000/alice/behoerden-briefkasten/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/ld+json" | python3 -m json.tool
```

Within ~30 seconds the Chrome Extension will fire a desktop notification.

---

## Quick Reference

| Action | Method | URL pattern | Key Headers |
|---|---|---|---|
| Create container | `PUT` | `.../name/` (trailing slash) | `Content-Type: text/turtle`, `Link: ldp#BasicContainer` |
| Upload file | `PUT` | `.../name.ext` | `Content-Type: <mime>` |
| List container | `GET` | `.../name/` | `Accept: application/ld+json` |
| Read file | `GET` | `.../name.ext` | `Accept: <mime>` |
| Update file | `PUT` | `.../name.ext` | `Content-Type: <mime>` |
| Delete | `DELETE` | `.../name` or `.../name/` | — |
| Read ACL | `GET` | `.../.acl` | `Accept: text/turtle` |
| Write ACL | `PUT` | `.../.acl` | `Content-Type: text/turtle` |

All requests that modify data require `Authorization: Bearer $TOKEN`.
