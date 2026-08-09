import { test } from "node:test";
import assert from "node:assert/strict";

// Configure the key BEFORE the tool module (and its config import) is evaluated.
// This file only uses dynamic import, so config reads the key set here.
process.env.COMPANIES_HOUSE_API_KEY = "test-key";

type FakeFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; json(): Promise<unknown> }>;

function fakeFetch(status: number, body: unknown, capture?: (url: string, init: { headers: Record<string, string> }) => void): FakeFetch {
  return async (url, init) => {
    if (capture) capture(url, init);
    return { status, json: async () => body };
  };
}

test("lookup_company by number returns ONLY the minimised public facts", async () => {
  const { handleLookupCompany } = await import("../src/tools/lookupCompany.js");
  let seenUrl = "";
  let seenAuth = "";
  const res = await handleLookupCompany(
    { company_number: "01234567" },
    fakeFetch(
      200,
      {
        company_name: "ACME TRADING LTD",
        company_number: "01234567",
        company_status: "active",
        date_of_creation: "2010-05-01",
        accounts: { overdue: false },
        registered_office_address: { locality: "London" }, // must be dropped
        sic_codes: ["47110"], // must be dropped
      },
      (url, init) => {
        seenUrl = url;
        seenAuth = init.headers.Authorization;
      },
    ),
  );

  assert.match(seenUrl, /\/company\/01234567$/);
  // Basic auth: base64 of "test-key:"
  assert.equal(seenAuth, "Basic " + Buffer.from("test-key:").toString("base64"));

  const sc = res.structuredContent as { company: Record<string, unknown> };
  assert.deepEqual(Object.keys(sc.company).sort(), [
    "accounts_overdue",
    "company_name",
    "company_number",
    "company_status",
    "date_of_creation",
  ]);
  assert.equal(sc.company.accounts_overdue, false);
  assert.equal("registered_office_address" in sc.company, false);
  assert.equal("sic_codes" in sc.company, false);
});

test("lookup_company search returns up to 5 minimal matches", async () => {
  const { handleLookupCompany } = await import("../src/tools/lookupCompany.js");
  const items = Array.from({ length: 8 }, (_, k) => ({
    title: "CO " + k,
    company_number: "0000000" + k,
    company_status: "active",
    address: { locality: "x" },
  }));
  const res = await handleLookupCompany({ query: "co" }, fakeFetch(200, { items }));
  const sc = res.structuredContent as { matches: unknown[] };
  assert.equal(sc.matches.length, 5);
  assert.deepEqual(Object.keys(sc.matches[0] as object).sort(), [
    "company_name",
    "company_number",
    "company_status",
  ]);
});

test("lookup_company surfaces 404 and API errors as tool errors", async () => {
  const { handleLookupCompany } = await import("../src/tools/lookupCompany.js");
  const notFound = await handleLookupCompany({ company_number: "99999999" }, fakeFetch(404, {}));
  assert.equal(notFound.isError, true);
  const failed = await handleLookupCompany({ company_number: "01234567" }, fakeFetch(500, {}));
  assert.equal(failed.isError, true);
});

test("lookup_company rejects empty input", async () => {
  const { handleLookupCompany } = await import("../src/tools/lookupCompany.js");
  const bad = await handleLookupCompany({}, fakeFetch(200, {}));
  assert.equal(bad.isError, true);
});
