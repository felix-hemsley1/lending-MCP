import { readFileSync } from "node:fs";
import { PRODUCTS_PATH } from "./config.js";

export interface Product {
  id: string;
  name: string;
  summary: string;
  [key: string]: unknown;
}

export interface ProductsFile {
  disclaimer: string;
  products: Product[];
}

let cache: ProductsFile | undefined;

/**
 * Load and cache the public product catalogue. All figures in the file are
 * `[VERIFY]` placeholders until a human replaces them with verified data.
 */
export function loadProducts(): ProductsFile {
  if (!cache) {
    cache = JSON.parse(readFileSync(PRODUCTS_PATH, "utf8")) as ProductsFile;
  }
  return cache;
}

export function getProductById(id: string): Product | undefined {
  return loadProducts().products.find((p) => p.id === id);
}

export function listProductIds(): string[] {
  return loadProducts().products.map((p) => p.id);
}
