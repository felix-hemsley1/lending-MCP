# iwoca ChatGPT MCP — Proof of Concept

A small Node/TypeScript MCP server for the **iwoca ChatGPT app**. It lets a UK
business ask about iwoca's products in natural language, run a loan repayment
estimator, and view the **iwoca Credit Compass** (a clearly-labelled demo).

It is built on the **standard** Model Context Protocol SDK (no OpenAI-specific
wrapper) so the same server can also back a Claude connector. All OpenAI Apps
SDK-specific glue is isolated in one module (`src/appsSdk.ts`).

## Phase 1 scope & ground rules

- **Read-only and stateless.** No auth, no PII, no persistence, no session state
  tied to a person. All three tools are annotated `readOnlyHint: true`,
  `openWorldHint: false`.
- **No invented iwoca figures.** `data/products.json` is populated from
  iwoca.co.uk (collected 2026-08-09 via domain-scoped search — direct site fetch
  was egress-blocked), with a `source` provenance block and per-figure caveats;
  anything not published as a single figure stays `[VERIFY]`. A human should
  re-read the live pages to confirm. The loan calculator never assumes an iwoca
  rate — the caller supplies an illustrative rate range.
- **Credit Compass is a demo.** It is not a credit score or decision and uses no
  real iwoca data. "Demo / illustrative" wording appears in the tool description,
  the tool output, and the widget.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_product_info` | Return public product info from `data/products.json` (sourced from iwoca.co.uk, with provenance + caveats). `product_id: "all"` (default) or a specific id. |
| `loan_calculator` | Amortise an amount over a term at a caller-supplied **illustrative** annual rate range; returns low/high estimates + disclaimer. |
| `credit_compass` | **Demo** illustrative view: score (35–90), band, 3 factors (each with a signal), `demo: true`, disclaimer. Advertises an HTML widget via the Apps SDK. |

## Tech stack

- Node.js ≥ 20 (CI runs 22), TypeScript (ESM)
- `@modelcontextprotocol/sdk` (Streamable HTTP + stdio transports)
- Fastify + `@fastify/cors`
- Zod for input validation
- Tests: built-in `node:test` (run through `tsx`)

## Project layout

```
src/
  mcp.ts            # MCP server factory: 3 tools + widget resource
  server.ts         # HTTP entry point (Streamable HTTP). Exports buildServer()
  stdio.ts          # stdio entry point (for the MCP Inspector)
  config.ts         # data/widget paths (env config expands in M2)
  products.ts       # loads data/products.json
  appsSdk.ts        # ISOLATED OpenAI Apps SDK keys (outputTemplate / skybridge)
  tools/
    getProductInfo.ts
    loanCalculator.ts
    creditCompass.ts
data/products.json  # public product data — all placeholder [VERIFY] values
widget/credit-compass.html  # self-contained Credit Compass widget (no external assets)
test/               # node:test suites (mcp.test.ts, http.test.ts)
```

## Running locally

```bash
npm install
npm run dev        # tsx watch, hot-reload
# or
npm run build && npm start
```

Defaults to `http://0.0.0.0:3000`. Env vars: `PORT` (3000), `HOST` (0.0.0.0),
`LOG_LEVEL` (info). (Broader env config lands in M2.)

## Local preview of the widgets

To click around the two widgets in a browser without ChatGPT:

```bash
npm run preview     # serves the repo on http://localhost:4321
# then open http://localhost:4321/preview/
```

The widgets run standalone here with sample/default values (in ChatGPT they receive
their data from the MCP tools). This is a UI preview only — it does not exercise the
MCP protocol; use the MCP Inspector below for that.

## Testing

```bash
npm test        # node:test via tsx — MCP protocol + HTTP smoke tests
npm run typecheck
```

## MCP Inspector

```bash
npm run inspector   # builds, then launches the Inspector on the stdio entry point
```

Open the printed URL, **Connect**, open **Tools → List Tools** (you should see
`get_product_info`, `loan_calculator`, `credit_compass`), and call each by hand.

## Endpoints

- `POST /mcp` — JSON-RPC (MCP Streamable HTTP)
- `GET /mcp` — SSE stream (per session)
- `DELETE /mcp` — tear down a session
- `GET /healthz` — liveness; returns server name, version, tool list

## Smoke test (curl)

The Streamable HTTP transport requires an `initialize` handshake before any other
call — a bare `tools/list` returns "Server not initialized".

```bash
# 1. Initialise — capture the mcp-session-id response header.
curl -i -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2024-11-05","capabilities":{},
                 "clientInfo":{"name":"curl","version":"0"}}}'

SID=<paste mcp-session-id>

# 2. List tools.
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. Estimate repayments (illustrative rate range — not an iwoca rate).
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"loan_calculator","arguments":{
          "amount_gbp":50000,"term_months":12,
          "min_annual_rate_pct":6,"max_annual_rate_pct":12}}}'
```

## Docker

```bash
docker build -t iwoca-mcp .
docker run -p 3000:3000 iwoca-mcp
```

## OpenAI Apps SDK note

The Apps SDK is in beta and its metadata keys have changed before. All such keys
(`openai/outputTemplate`, the `text/html+skybridge` MIME type, `window.openai.*`)
are isolated in `src/appsSdk.ts` with a pointer to
<https://developers.openai.com/apps-sdk>. A plain MCP client that doesn't
understand them ignores them and uses the text / structured content instead.

## Not the server: `demo/`

`demo/index.html` is a **standalone browser mockup** of the ChatGPT experience
(deployed to GitHub Pages by `.github/workflows/deploy-demo.yml`). It is not part
of the MCP server and currently still depicts the earlier application flow.

## What's deliberately out of scope (Phase 1)

No underwriting, credit scoring, KYC/AML, Open Banking, document processing, CRM
integration, production iwoca APIs, authentication, PII collection, or persistence.
