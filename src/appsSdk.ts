import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WIDGET_DIR } from "./config.js";

/**
 * ============================================================================
 *  OpenAI Apps SDK-specific glue — ISOLATED ON PURPOSE.
 * ============================================================================
 *
 *  Everything OpenAI/ChatGPT-specific lives in this one module so the rest of
 *  the server stays on the plain Model Context Protocol and can equally back a
 *  Claude connector. If OpenAI changes these conventions, this file is the only
 *  thing that should need touching.
 *
 *  The Apps SDK is in BETA and these keys HAVE changed before. Always confirm
 *  against the current docs before trusting anything here:
 *      https://developers.openai.com/apps-sdk
 *
 *  VERIFICATION NOTE (2026-08-09): the official docs host (developers.openai.com)
 *  was unreachable from this build environment (blocked by the network egress
 *  proxy), so the key names below were confirmed against SECONDARY sources only
 *  and MUST be re-verified by a human against the primary docs before submission.
 *
 *  Conventions used (all beta, all subject to change):
 *   - A tool advertises an HTML widget by attaching, in its `_meta`, the key
 *     `openai/outputTemplate` set to a `ui://` resource URI.
 *   - That URI resolves to an MCP resource whose `mimeType` is
 *     `text/html+skybridge`, whose body is a self-contained HTML document.
 *   - Inside the widget, the host exposes `window.openai` — in particular
 *     `window.openai.toolOutput` carries the tool's `structuredContent`.
 * ============================================================================
 */

/** `_meta` key that links a tool to its HTML output template. */
export const OUTPUT_TEMPLATE_META_KEY = "openai/outputTemplate";

/** MIME type the host expects for an Apps SDK (skybridge) HTML widget. */
export const WIDGET_MIME_TYPE = "text/html+skybridge";

/** Resource URIs for the chat-surfaced widgets. */
export const CREDIT_COMPASS_WIDGET_URI = "ui://widget/credit-compass.html";
export const LOAN_CALCULATOR_WIDGET_URI = "ui://widget/loan-calculator.html";

const CREDIT_COMPASS_WIDGET_FILE = resolve(WIDGET_DIR, "credit-compass.html");
const LOAN_CALCULATOR_WIDGET_FILE = resolve(WIDGET_DIR, "loan-calculator.html");

/** Read the widget HTML from disk (small files, read on demand). */
export function readCreditCompassWidget(): string {
  return readFileSync(CREDIT_COMPASS_WIDGET_FILE, "utf8");
}
export function readLoanCalculatorWidget(): string {
  return readFileSync(LOAN_CALCULATOR_WIDGET_FILE, "utf8");
}

/** `_meta` blocks linking each tool to its widget. */
export const creditCompassToolMeta = {
  [OUTPUT_TEMPLATE_META_KEY]: CREDIT_COMPASS_WIDGET_URI,
} as const;
export const loanCalculatorToolMeta = {
  [OUTPUT_TEMPLATE_META_KEY]: LOAN_CALCULATOR_WIDGET_URI,
} as const;

/** Descriptors for the widgets as MCP resources (for resources/list). */
export const creditCompassWidgetResource = {
  uri: CREDIT_COMPASS_WIDGET_URI,
  name: "iwoca Credit Compass widget",
  description:
    "Compact in-chat card: DEMO Credit Compass estimate (score, band, factors) and " +
    "a rough, non-guaranteed indicative monthly rate.",
  mimeType: WIDGET_MIME_TYPE,
} as const;
export const loanCalculatorWidgetResource = {
  uri: LOAN_CALCULATOR_WIDGET_URI,
  name: "iwoca Loan Calculator widget",
  description:
    "Compact in-chat card: interactive daily-interest cost calculator (rate slider, " +
    "term, reducing-balance schedule, early repayment) with an application link.",
  mimeType: WIDGET_MIME_TYPE,
} as const;
