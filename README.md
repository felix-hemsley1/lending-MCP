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
  — not iwoca's real pricing. The application link defaults to
  `https://www.iwoca.co.uk/apply/new` (override via `IWOCA_APPLICATION_URL`).
- **Credit Compass is a demo.** It is not a credit score or decision and uses no
  real iwoca data. "Demo / illustrative" wording appears in the tool description,
  the tool output, and the widget.

## Design: chat-first

The chat is the interface — in ChatGPT the host model carries the conversation
(how iwoca works, use cases, comparisons, reviews) using the knowledge tools, and
surfaces the compass / calculator widgets inline when the user wants an estimate
or a cost view. `demo/index.html` is a scripted local mock of that experience.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_iwoca_info` | Conversational knowledge: how it works, use cases, comparison (iwoca's published positioning), testimonials/Trustpilot, rates & fees, eligibility — from `data/knowledge.json` (sourced, with provenance; `[VERIFY]` marks unconfirmed content). |
| `get_product_info` | Public product info from `data/products.json` (sourced from iwoca.co.uk, with provenance + caveats). |
| `lookup_company` | Public **Companies House** registry lookup (by number or name search). Returns only name, number, status, incorporation date, accounts-overdue flag — data-minimised. Registry facts, **not a credit score**. `openWorldHint: true` (external API). Needs a free `COMPANIES_HOUSE_API_KEY`. |
| `credit_compass` | **Demo** estimate widget: score (35–90), band, factors, plus a **rough, non-guaranteed** indicative monthly rate. Fake illustrative logic — no real iwoca data. Can ingest `lookup_company` facts as a labelled input factor; the score stays the demo mock. |
| `loan_calculator` | Cost widget: rate slider (1.5–5.7%/month, default the representative 3.3%, or the compass rate), term 12/24/48/60, daily interest on the reducing balance, over-12-month fee, early-repayment savings, apply link. |

Shared maths live in `src/finance.ts`.

## Tech stack

- Node.js ≥ 20 (CI runs 22), TypeScript (ESM)
- `@modelcontextprotocol/sdk` (Streamable HTTP + stdio transports)
- Fastify + `@fastify/cors`
- Zod for input validation
- Tests: built-in `node:test` (run through `tsx`)

## Project layout

```
src/
  mcp.ts            # MCP server factory: 4 tools + 2 widget resources
  server.ts         # HTTP entry point (Streamable HTTP). Exports buildServer()
  stdio.ts          # stdio entry point (for the MCP Inspector)
  config.ts         # data/widget paths, application URL (env config expands in M2)
  products.ts       # loads data/products.json
  finance.ts        # shared maths: demo compass, indicative rate, amortising cost
  appsSdk.ts        # ISOLATED OpenAI Apps SDK keys (outputTemplate / skybridge)
  tools/
    getIwocaInfo.ts
    getProductInfo.ts
    lookupCompany.ts     # Companies House public lookup (needs COMPANIES_HOUSE_API_KEY)
    creditCompass.ts
    loanCalculator.ts
data/products.json   # public product data (from iwoca.co.uk, with provenance)
data/knowledge.json  # conversational knowledge (sourced, with provenance)
widget/credit-compass.html   # in-chat estimate card (self-contained)
widget/loan-calculator.html  # in-chat cost calculator card (self-contained)
demo/index.html      # scripted chat demo of the full experience
preview/index.html   # widget preview page (npm run preview)
test/                # node:test suites (mcp.test.ts, http.test.ts)
```

## Running locally

```bash
npm install
npm run dev        # tsx watch, hot-reload
# or
npm run build && npm start
```

Defaults to `http://0.0.0.0:3000`. Env vars (see `.env.example`): `PORT` (3000),
`HOST` (0.0.0.0), `LOG_LEVEL` (info), `IWOCA_APPLICATION_URL`, and
`COMPANIES_HOUSE_API_KEY`. (Broader env config lands in M2.)

### Companies House lookup (public data)

`lookup_company` calls the free [Companies House API](https://developer.company-information.service.gov.uk)
(HTTP Basic auth, API key as username, blank password — verified 2026-08-09). Set
`COMPANIES_HOUSE_API_KEY` to enable it; without a key the tool returns a clear
"not configured" message. It returns **only** name, number, status, incorporation
date, and the accounts-overdue flag (data minimisation) — these are **public
registry facts, not a credit score**. The Compass can take them as a labelled
input factor, but its score remains the demo mock. **Never commit the key** (`.env`
is git-ignored; copy `.env.example` to `.env`).

## Local chat demo + widget preview

```bash
npm run preview     # serves the repo on http://localhost:4321
# chat demo:      http://localhost:4321/demo/
# widget preview: http://localhost:4321/preview/
```

The chat demo is a scripted mock of the ChatGPT experience — conversation plus
inline compass/calculator cards. It runs no real model and stores nothing. The
widget preview shows the two MCP widgets standalone. Neither exercises the MCP
protocol; use the MCP Inspector below for that.

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
`get_iwoca_info`, `get_product_info`, `lookup_company`, `credit_compass`,
`loan_calculator`), and call each by hand.

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

`demo/index.html` is a **standalone scripted mockup** of the ChatGPT experience
(deployed to GitHub Pages by `.github/workflows/deploy-demo.yml`). It mirrors the
knowledge data and widget maths but runs no real model and is not part of the MCP
server.

## What's deliberately out of scope (Phase 1)

No underwriting, credit scoring, KYC/AML, Open Banking, document processing, CRM
integration, production iwoca APIs, authentication, PII collection, or persistence.
