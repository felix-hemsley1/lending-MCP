# iwoca ChatGPT MCP — Proof of Concept

A small Node/TypeScript MCP server for the **iwoca ChatGPT app**. It lets a UK
business ask about iwoca's products in natural language, run a loan repayment
estimator, and view the **iwoca Credit Compass** (a clearly-labelled demo).

It is built on the **standard** Model Context Protocol SDK (no OpenAI-specific
wrapper) so the same server can also back a Claude connector. All OpenAI Apps
SDK-specific glue is isolated in one module (`src/appsSdk.ts`).

## Phase 1 scope & ground rules

- **Read-only and stateless.** No auth, no PII, no persistence, no session state
  tied to a person. Both tools are annotated `readOnlyHint: true`,
  `openWorldHint: false`.
- **No invented iwoca figures.** `data/products.json` is populated from
  iwoca.co.uk (collected 2026-08-09 via domain-scoped search — direct site fetch
  was egress-blocked), with a `source` provenance block and per-figure caveats;
  anything not published as a single figure stays `[VERIFY]`. A human should
  re-read the live pages to confirm. The estimator's indicative rate is derived
  from the **demo** Credit Compass and labelled a rough, non-guaranteed estimate
  — not iwoca's real pricing. The application link (`IWOCA_APPLICATION_URL`) is a
  **placeholder** pending the real URL.
- **Credit Compass is a demo.** It is not a credit score or decision and uses no
  real iwoca data. "Demo / illustrative" wording appears in the tool description,
  the tool output, and the widget.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_product_info` | Return public product info from `data/products.json` (sourced from iwoca.co.uk, with provenance + caveats). `product_id: "all"` (default) or a specific id. |
| `iwoca_finance_estimator` | Guided journey in one widget: what you need → business details → **demo** Credit Compass estimate + a **rough, non-guaranteed** indicative monthly rate → daily-interest cost calculator (amortising, over-12-month fee) → application link for an exact rate. Advertises the widget via the Apps SDK. |

The estimator merges the earlier separate `credit_compass` and `loan_calculator`
tools into one build. Shared maths live in `src/finance.ts`.

## Tech stack

- Node.js ≥ 20 (CI runs 22), TypeScript (ESM)
- `@modelcontextprotocol/sdk` (Streamable HTTP + stdio transports)
- Fastify + `@fastify/cors`
- Zod for input validation
- Tests: built-in `node:test` (run through `tsx`)

## Project layout

```
src/
  mcp.ts            # MCP server factory: tools + widget resource
  server.ts         # HTTP entry point (Streamable HTTP). Exports buildServer()
  stdio.ts          # stdio entry point (for the MCP Inspector)
  config.ts         # data/widget paths, application URL (env config expands in M2)
  products.ts       # loads data/products.json
  finance.ts        # shared maths: demo compass, indicative rate, amortising cost
  appsSdk.ts        # ISOLATED OpenAI Apps SDK keys (outputTemplate / skybridge)
  tools/
    getProductInfo.ts
    financeEstimator.ts
data/products.json  # public product data (from iwoca.co.uk, with provenance)
widget/iwoca-finance.html   # self-contained guided finance widget (no external assets)
preview/index.html  # local preview page (npm run preview)
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
`get_product_info` and `iwoca_finance_estimator`), and call each by hand.

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
