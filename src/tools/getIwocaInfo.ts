import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Conversational knowledge about iwoca — how it works, use cases, comparisons,
 * customer feedback, rates & fees, eligibility. Content comes from
 * data/knowledge.json (published iwoca.co.uk / Trustpilot material with
 * provenance recorded in the file; [VERIFY] marks anything needing human
 * confirmation). This tool is what lets the chat "talk about iwoca" with
 * grounded answers instead of model guesses.
 */

const KNOWLEDGE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "knowledge.json",
);

const TOPICS = [
  "how_it_works",
  "use_cases",
  "comparison",
  "testimonials",
  "rates_and_fees",
  "eligibility",
  "all",
] as const;

interface KnowledgeFile {
  disclaimer: string;
  source: unknown;
  topics: Record<string, unknown>;
}

let cache: KnowledgeFile | undefined;
function loadKnowledge(): KnowledgeFile {
  if (!cache) {
    cache = JSON.parse(readFileSync(KNOWLEDGE_PATH, "utf8")) as KnowledgeFile;
  }
  return cache;
}

export const getIwocaInfoDefinition = {
  name: "get_iwoca_info",
  title: "About iwoca (how it works, use cases, reviews…)",
  description:
    "Answer conversational questions about iwoca: how it works, what businesses " +
    "use the funding for, how iwoca compares to traditional lenders (iwoca's own " +
    "published positioning), customer feedback and Trustpilot rating, rates & fees, " +
    "and eligibility. Pass a topic, or 'all' for everything. Content is sourced from " +
    "iwoca's published pages; entries marked [VERIFY] are unconfirmed and must not " +
    "be presented as fact.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: {
        type: "string",
        enum: [...TOPICS],
        description: `One of ${TOPICS.join(", ")}. Defaults to 'all'.`,
      },
    },
  },
} as const;

const inputSchema = z.object({
  topic: z.enum(TOPICS).optional(),
});

export async function handleGetIwocaInfo(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: `Invalid input: topic must be one of ${TOPICS.join(", ")}.`,
        },
      ],
    };
  }

  const knowledge = loadKnowledge();
  const topic = parsed.data.topic ?? "all";

  const topics =
    topic === "all"
      ? knowledge.topics
      : { [topic]: knowledge.topics[topic] };

  if (topic !== "all" && !knowledge.topics[topic]) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: `Unknown topic '${topic}'. Known: ${Object.keys(knowledge.topics).join(", ")}.`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          JSON.stringify(topics, null, 2) +
          "\n\n" +
          knowledge.disclaimer,
      },
    ],
    structuredContent: { disclaimer: knowledge.disclaimer, topics },
  };
}
