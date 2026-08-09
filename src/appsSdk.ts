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

/** Resource URI for the unified iwoca finance widget. */
export const IWOCA_FINANCE_WIDGET_URI = "ui://widget/iwoca-finance.html";

const IWOCA_FINANCE_WIDGET_FILE = resolve(WIDGET_DIR, "iwoca-finance.html");

/** Read the widget HTML from disk (small file, read on demand). */
export function readIwocaFinanceWidget(): string {
  return readFileSync(IWOCA_FINANCE_WIDGET_FILE, "utf8");
}

/** The `_meta` block to attach to the finance estimator tool definition. */
export const iwocaFinanceToolMeta = {
  [OUTPUT_TEMPLATE_META_KEY]: IWOCA_FINANCE_WIDGET_URI,
} as const;

/** Descriptor for the widget as an MCP resource (for resources/list). */
export const iwocaFinanceWidgetResource = {
  uri: IWOCA_FINANCE_WIDGET_URI,
  name: "iwoca finance estimator widget",
  description:
    "Self-contained interactive HTML widget: a guided journey from what you need " +
    "and your business details, to an illustrative Credit Compass estimate and rough " +
    "indicative rate, a daily-interest cost calculator, and an application link.",
  mimeType: WIDGET_MIME_TYPE,
} as const;
