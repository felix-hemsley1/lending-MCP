import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Small runtime config surface. Kept intentionally minimal for Phase 1.
 * (M2 will move port / data paths / rate-limit settings fully behind env
 * config; for now we only need the paths the tools load from.)
 */

const here = dirname(fileURLToPath(import.meta.url));
// src/ at dev time, dist/ at runtime — data/ and widget/ live at the repo root
// one level up from either.
const projectRoot = resolve(here, "..");

export const PRODUCTS_PATH = resolve(projectRoot, "data", "products.json");
export const WIDGET_DIR = resolve(projectRoot, "widget");
