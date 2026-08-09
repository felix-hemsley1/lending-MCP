import { z } from "zod";
import { loadProducts, getProductById, listProductIds } from "../products.js";

export const getProductInfoDefinition = {
  name: "get_product_info",
  title: "Get iwoca product information",
  description:
    "Return public, general information about iwoca's business finance products. " +
    "Pass product_id 'all' (the default) for every product, or a specific product id " +
    "for just that one. Figures shown as '[VERIFY]' are unconfirmed placeholders and " +
    "must not be presented as real iwoca terms.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      product_id: {
        type: "string",
        description:
          "Product id to look up, or 'all' for every product. Defaults to 'all'.",
      },
    },
  },
} as const;

const inputSchema = z.object({
  product_id: z.string().trim().min(1).optional(),
});

export async function handleGetProductInfo(rawArgs: unknown) {
  const parsed = inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Invalid input: product_id must be a non-empty string or omitted.",
        },
      ],
    };
  }

  const { disclaimer } = loadProducts();
  const requested = parsed.data.product_id ?? "all";

  if (requested === "all") {
    const products = loadProducts().products;
    return {
      content: [
        {
          type: "text" as const,
          text:
            `${products.length} iwoca product(s). ${disclaimer}\n\n` +
            products.map((p) => `- ${p.name} (${p.id}): ${p.summary}`).join("\n"),
        },
      ],
      structuredContent: { disclaimer, products },
    };
  }

  const product = getProductById(requested);
  if (!product) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text:
            `Unknown product '${requested}'. Known ids: ${listProductIds().join(", ")}, or 'all'.`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `${product.name} (${product.id}): ${product.summary}\n\n${disclaimer}`,
      },
    ],
    structuredContent: { disclaimer, product },
  };
}
