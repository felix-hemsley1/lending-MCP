# iwoca ChatGPT App — Project Plan

Building an iwoca app for the ChatGPT app directory: UK businesses ask about
iwoca's products in natural language, run a loan repayment estimator, and view the
**iwoca Credit Compass** (a clearly-labelled demo). Built on the standard MCP SDK
so the same server can back a Claude connector.

## Ground rules

1. **Never invent iwoca figures.** Rates, limits, terms, eligibility stay as
   `[VERIFY]` placeholders until a human replaces them with verified data.
2. **Phase 1 = zero personal data.** No auth, no PII, no session state tied to a
   person. If a task seems to need user data, stop and flag it.
3. **Stay on the standard MCP SDK.** OpenAI Apps SDK-specific keys are isolated in
   `src/appsSdk.ts`. Verify keys against <https://developers.openai.com/apps-sdk>
   before relying on them (the SDK is beta and keys have changed).
4. **Tool annotations must be accurate** — everything in Phase 1 is `readOnlyHint:
   true`, `openWorldHint: false`.
5. **Responses stay short, factual JSON** with disclaimers embedded in the output.
   No internal IDs, telemetry, timestamps, or debug fields in tool responses.
6. **Compass is a demo** — "demo / illustrative, not a credit decision" wording in
   the tool description, tool output, and widget. Not wired to any real scoring.

## Phases / milestones

| # | Milestone | Status |
| --- | --- | --- |
| M1 | Baseline + test harness (3 read-only tools, `npm test`, CI) | **Done** |
| M2 | Config & hardening (env config, rate limiting, structured logging, graceful shutdown, Dockerfile) | Not started |
| M3 | TypeScript migration / zod single source of truth (optional — the repo is already TS) | Optional |
| M4 | Companies House lookup (`lookup_company`, public data only, API key in env) | Not started |
| M5 | Developer Mode demo pack (`docs/demo.md`, tunnel steps, 6-prompt script) | Not started |
| M6 | Submission artefacts (listing metadata, privacy field inventory, test cases, domain verification) — draft only | Not started |

### M1 — Baseline + test harness (done)

- Three read-only tools: `get_product_info`, `loan_calculator`, `credit_compass`.
- `data/products.json` — public product data, all `[VERIFY]` placeholders.
- `widget/credit-compass.html` — self-contained widget (no external assets).
- OpenAI Apps SDK glue isolated in `src/appsSdk.ts`.
- `node:test` suite (`test/`) + `npm test` + GitHub Actions (`.github/workflows/ci.yml`).

## Submission checklist (for M6, do not submit yet)

- [ ] Listing metadata (name, subtitle, description, category)
- [ ] Privacy-policy field inventory (every user-related field each tool returns)
- [ ] 5 positive + 3 negative test cases with expected behaviour
- [ ] Domain-verification token endpoint (confirm well-known path from current docs)
- [ ] All `[VERIFY]` placeholders replaced with verified iwoca data by a human
- [ ] Tool annotations re-checked against final behaviour
- [ ] Apps SDK keys re-verified against the current primary docs

## Risks / open items

- **Apps SDK is beta.** Keys (`openai/outputTemplate`, `text/html+skybridge`,
  `window.openai.*`) may change; keep them isolated and re-verify before submission.
  (The official docs host was unreachable from the build environment when M1 was
  written — keys were confirmed against secondary sources and need human re-check.)
- **Placeholder data.** Product figures are `[VERIFY]` and must be filled by a human.
- **`demo/index.html`** still depicts the earlier application-submission flow and is
  separate from the MCP server; update or retire before any public showcase.
