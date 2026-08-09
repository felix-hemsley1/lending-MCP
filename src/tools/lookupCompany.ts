import { z } from "zod";
import {
  COMPANIES_HOUSE_API_BASE,
  COMPANIES_HOUSE_API_KEY,
} from "../config.js";

/**
 * Companies House public-register lookup (M4).
 *
 * DATA MINIMISATION (deliberate): from everything the register offers we return
 * ONLY company name, number, status, incorporation date, and the accounts-overdue
 * flag (search results: name/number/status). No officers, no addresses, no PSCs —
 * officer data is personal data and Phase 1 collects none.
 *
 * NOTE: Companies House publishes registry FACTS, not credit scores. This tool
 * must never be presented as a credit check.
 *
 * Auth (verified 2026-08-09): HTTP Basic, API key as username, blank password.
 */

export interface CompanyFacts {
  company_name: string;
  company_number: string;
  company_status: string;
  date_of_creation: string | null;
  accounts_overdue: boolean;
}

export interface CompanySearchHit {
  company_name: string;
  company_number: string;
  company_status: string;
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export const lookupCompanyDefinition = {
  name: "lookup_company",
  title: "Look up a company on Companies House",
  description:
    "Look up public UK company facts on the Companies House register: name, " +
    "company number, status, incorporation date, and whether accounts are overdue. " +
    "Pass company_number for an exact lookup, or query to search by name (returns up " +
    "to 5 matches to confirm with the user). This is public registry data only — it " +
    "is NOT a credit score or credit check. After confirming the right company, you " +
    "can pass these facts to credit_compass as labelled inputs (its score stays a demo).",
  annotations: {
    readOnlyHint: true,
    // Accurate annotation: this tool calls the external Companies House API.
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      company_number: {
        type: "string",
        description: "Companies House company number, e.g. '01234567'.",
      },
      query: {
        type: "string",
        description: "Company name to search for when the number isn't known.",
      },
    },
  },
} as const;

const inputSchema = z
  .object({
    company_number: z.string().trim().min(2).max(10).optional(),
    query: z.string().trim().min(2).max(160).optional(),
  })
  .refine((v) => v.company_number !== undefined || v.query !== undefined, {
    message: "Provide company_number or query.",
  });

function authHeaders(): Record<string, string> {
  // Basic auth: key as username, blank password.
  const token = Buffer.from(`${COMPANIES_HOUSE_API_KEY}:`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function err(text: string) {
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}

/** `fetchImpl` is injectable so tests can run without a key or network. */
export async function handleLookupCompany(
  rawArgs: unknown,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return err(
      "Invalid input: pass company_number (e.g. '01234567') or query (a company name).",
    );
  }

  if (!COMPANIES_HOUSE_API_KEY) {
    return err(
      "Companies House lookup is not configured on this server (COMPANIES_HOUSE_API_KEY is unset). " +
        "A free key is available from developer.company-information.service.gov.uk.",
    );
  }

  const { company_number, query } = parsed.data;

  try {
    if (company_number !== undefined) {
      const res = await fetchImpl(
        `${COMPANIES_HOUSE_API_BASE}/company/${encodeURIComponent(company_number)}`,
        { headers: authHeaders() },
      );
      if (res.status === 404) {
        return err(`No company found with number '${company_number}'.`);
      }
      if (res.status !== 200) {
        return err(`Companies House lookup failed (HTTP ${res.status}). Try again shortly.`);
      }
      const raw = (await res.json()) as {
        company_name?: string;
        company_number?: string;
        company_status?: string;
        date_of_creation?: string;
        accounts?: { overdue?: boolean };
      };
      const facts: CompanyFacts = {
        company_name: raw.company_name ?? "",
        company_number: raw.company_number ?? company_number,
        company_status: raw.company_status ?? "unknown",
        date_of_creation: raw.date_of_creation ?? null,
        accounts_overdue: raw.accounts?.overdue === true,
      };
      const text = [
        `Companies House record (public register, not a credit check):`,
        `- Name: ${facts.company_name}`,
        `- Number: ${facts.company_number}`,
        `- Status: ${facts.company_status}`,
        `- Incorporated: ${facts.date_of_creation ?? "unknown"}`,
        `- Accounts overdue: ${facts.accounts_overdue ? "YES" : "no"}`,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { source: "companies_house" as const, company: facts },
      };
    }

    const res = await fetchImpl(
      `${COMPANIES_HOUSE_API_BASE}/search/companies?q=${encodeURIComponent(query!)}&items_per_page=5`,
      { headers: authHeaders() },
    );
    if (res.status !== 200) {
      return err(`Companies House search failed (HTTP ${res.status}). Try again shortly.`);
    }
    const raw = (await res.json()) as {
      items?: { title?: string; company_number?: string; company_status?: string }[];
    };
    const matches: CompanySearchHit[] = (raw.items ?? []).slice(0, 5).map((it) => ({
      company_name: it.title ?? "",
      company_number: it.company_number ?? "",
      company_status: it.company_status ?? "unknown",
    }));
    if (matches.length === 0) {
      return err(`No companies found matching '${query}'.`);
    }
    const text = [
      `Companies House matches for '${query}' (confirm the right one with the user, then look it up by number):`,
      ...matches.map(
        (m) => `- ${m.company_name} — ${m.company_number} (${m.company_status})`,
      ),
    ].join("\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { source: "companies_house" as const, matches },
    };
  } catch (e) {
    return err(
      `Companies House lookup failed: ${e instanceof Error ? e.message : "network error"}.`,
    );
  }
}
