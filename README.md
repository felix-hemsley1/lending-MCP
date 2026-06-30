# iwoca ChatGPT MCP — Proof of Concept

A small Node/TypeScript MCP server that lets a user start an **iwoca business finance application** entirely from inside a ChatGPT conversation.

The server exposes three tools over the Model Context Protocol's **Streamable HTTP** transport so it can be installed as a ChatGPT MCP app:

| Tool | Purpose |
| --- | --- |
| `draft_application` | Validate the applicant's details and store a `draft` row. Returns a draft ID and a human-readable summary. |
| `submit_application` | Promote a draft to `submitted`, mint a mock `IW-100001`-style reference and return a secure (mock) upload URL. |
| `get_application_status` | Look up the current status for a reference. Auto-progresses `Submitted → Under Review → Documents Requested` over time to make the demo feel alive. |

> ⚠️ This is a **proof of concept**. It performs no underwriting, KYC, AML, credit, document, or CRM integration. The upload URL is a placeholder on `demo.iwoca.app`.

## Tech stack

- Node.js ≥ 20, TypeScript (ESM)
- `@modelcontextprotocol/sdk` (Streamable HTTP server transport)
- Fastify + `@fastify/cors`
- Zod for input validation
- `better-sqlite3` for persistence (single `applications` table)
- Optional Docker image

## Project layout

```
iwoca-poc/
  src/
    server.ts                    # Fastify + MCP Streamable HTTP transport
    database.ts                  # SQLite schema and connection
    validation.ts                # Zod schemas + error formatter
    tools/
      draftApplication.ts
      submitApplication.ts
      getApplicationStatus.ts
    services/
      applicationService.ts      # Draft / submit / status logic
  package.json
  tsconfig.json
  Dockerfile
  README.md
```

## Running locally

```bash
npm install
npm run dev        # tsx watch, hot-reload
# or
npm run build && npm start
```

The server listens on `http://0.0.0.0:3000` by default. Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `IWOCA_DB_PATH` | `data/iwoca.sqlite` | SQLite file path (parent dir auto-created). |
| `LOG_LEVEL` | `info` | Fastify log level. |

### Endpoints

- `POST /mcp` — JSON-RPC requests (MCP Streamable HTTP).
- `GET /mcp` — SSE stream for server → client messages (per session).
- `DELETE /mcp` — Tear down a session.
- `GET /healthz` — Liveness probe; returns server name, version, and tool list.

The transport requires the standard MCP headers:

- `Accept: application/json, text/event-stream`
- `Mcp-Session-Id: <session-id>` after the first `initialize` call.

## Docker

```bash
docker build -t iwoca-mcp .
docker run -p 3000:3000 -v $PWD/data:/app/data iwoca-mcp
```

## Smoke test (curl)

```bash
# 1. Initialise a session — capture the mcp-session-id response header.
curl -i -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-06-18","capabilities":{},
                 "clientInfo":{"name":"curl","version":"0"}}}'

SID=<paste mcp-session-id>

# 2. Send the initialized notification.
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. Draft an application.
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"draft_application","arguments":{
          "first_name":"Jane","last_name":"Doe",
          "company_name":"Acme Bakery Ltd",
          "amount_requested":50000,"annual_turnover":350000,
          "use_of_funds":"Buy a new oven and hire 2 staff",
          "funds_duration":"12 months",
          "email":"jane@acmebakery.co.uk","phone":"+44 7700 900123"}}}'

# 4. Submit using the draft_id from the previous response.
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"submit_application","arguments":{
          "draft_id":"<draft_id>","confirmed":true}}}'

# 5. Check status with the returned IW-#### reference.
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
        "name":"get_application_status","arguments":{
          "application_reference":"IW-100001"}}}'
```

## Connecting from ChatGPT

In ChatGPT, add the MCP server's public URL (`https://<your-host>/mcp`) as a Streamable HTTP MCP connector. ChatGPT will then naturally:

1. Ask the user for any missing application fields.
2. Call `draft_application` with the collected fields.
3. Read the returned summary back to the user.
4. Ask for confirmation.
5. Call `submit_application` with `confirmed: true`.
6. Share the `IW-#####` reference and the secure upload link.
7. Call `get_application_status` on demand to report progress.

To expose a local instance for testing, tunnel it (e.g. `ngrok http 3000`) and use the public URL.

## Data model

A single `applications` table:

| column | type | notes |
| --- | --- | --- |
| `id` | TEXT (UUID) | primary key, the `draft_id` |
| `reference` | TEXT | `IW-100001`+, set on submission |
| `status` | TEXT | `draft` → `submitted` → `under_review` → `documents_requested` |
| `first_name`, `last_name`, `company_name` | TEXT | |
| `amount_requested`, `annual_turnover` | REAL | GBP |
| `use_of_funds`, `funds_duration` | TEXT | |
| `email`, `phone` | TEXT | |
| `created_at`, `updated_at` | TEXT | ISO-8601 |

## Validation rules

Enforced by Zod in `src/validation.ts`:

- All fields required and non-empty.
- `amount_requested` > 0 and ≤ £1,000,000.
- `annual_turnover` numeric and ≥ 0.
- `email` must be a valid address.
- `phone` must match `^\+?[0-9 ()\-]{7,20}$`.
- `submit_application` requires `confirmed: true` (a literal `true`, not just truthy).

Validation failures are returned as `isError: true` tool results with a bullet list of issues so the model can ask the user for the missing/invalid fields.

## What's deliberately out of scope

No underwriting, credit scoring, KYC/AML, Open Banking, document processing, OCR, email delivery, CRM integration, production iwoca APIs, authentication, dashboards, or notifications. The goal is purely to demonstrate the **conversational application flow** end-to-end inside ChatGPT.
