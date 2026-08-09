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
 *  (community/tooling docs describing the Apps SDK "skybridge" convention). They
 *  are believed correct but MUST be re-verified by a human against the primary
 *  docs before submission.
 *
 *  Conventions used (all beta, all subject to change):
 *   - A tool advertises an HTML widget by attaching, in its `_meta`, the key
 *     `openai/outputTemplate` set to a `ui://` resource URI.
 *   - That URI must resolve to an MCP resource whose `mimeType` is
 *     `text/html+skybridge`, whose body is a self-contained HTML document.
 *   - Inside the widget, the host exposes `window.openai` — in particular
 *     `window.openai.toolOutput` carries the tool's `structuredContent`.
 * ============================================================================
 */

/** `_meta` key that links a tool to its HTML output template. */
export const OUTPUT_TEMPLATE_META_KEY = "openai/outputTemplate";

/** MIME type the host expects for an Apps SDK (skybridge) HTML widget. */
export const WIDGET_MIME_TYPE = "text/html+skybridge";

/** Resource URI for the Credit Compass widget. */
export const CREDIT_COMPASS_WIDGET_URI = "ui://widget/credit-compass.html";

const CREDIT_COMPASS_WIDGET_FILE = resolve(WIDGET_DIR, "credit-compass.html");

/** Read the widget HTML from disk (small file, read on demand). */
export function readCreditCompassWidget(): string {
  return readFileSync(CREDIT_COMPASS_WIDGET_FILE, "utf8");
}

/**
 * The `_meta` block to attach to the credit_compass tool definition so a host
 * that understands the Apps SDK will render the widget. A plain MCP client that
 * does not understand this key simply ignores it and uses the text /
 * structuredContent instead.
 */
export const creditCompassToolMeta = {
  [OUTPUT_TEMPLATE_META_KEY]: CREDIT_COMPASS_WIDGET_URI,
} as const;

/** Descriptor for the widget as an MCP resource (for resources/list). */
export const creditCompassWidgetResource = {
  uri: CREDIT_COMPASS_WIDGET_URI,
  name: "iwoca Credit Compass widget",
  description:
    "Self-contained HTML widget that renders the illustrative iwoca Credit Compass demo output.",
  mimeType: WIDGET_MIME_TYPE,
} as const;
