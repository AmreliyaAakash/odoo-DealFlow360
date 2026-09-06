import "server-only";
import { loadCatalog } from "@/lib/catalog-server";
import { formatCurrency } from "@/lib/quotations";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/** Product lookup, for "what does X cost" and "do we sell anything like Y". */

const searchProducts: ChatTool = {
  id: "search_products",
  description:
    "Search the product catalogue by name, SKU or category. Returns list price, unit, " +
    "billing cadence and margin. Use before quoting any price.",
  module: "products",
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Partial name, SKU or category." },
      limit: { type: "integer", description: "How many to return (default 10, max 25)." },
    },
  },
  execute: async (args) => {
    const { products, error } = await loadCatalog();
    if (error) return { error: "Could not read the product catalogue." };

    const needle = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";

    const matched = products.filter((product) => {
      if (!product.active) return false;
      if (!needle) return true;
      return [product.name, product.sku, product.category].some((field) =>
        (field ?? "").toLowerCase().includes(needle),
      );
    });

    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);

    return {
      matched: matched.length,
      products: matched.slice(0, limit).map((product) => ({
        name: product.name,
        sku: product.sku,
        category: product.category,
        listPrice: formatCurrency(product.listPrice),
        unit: product.unit,
        cadence: product.cadence,
        // The margin, not the cost: a rep may quote a price and should know how
        // much room it leaves, but the cost line itself is not theirs to repeat
        // to a customer.
        marginPct:
          product.listPrice > 0
            ? Number((((product.listPrice - product.cost) / product.listPrice) * 100).toFixed(1))
            : null,
        variants: product.variantSummary,
        page: `/products/${product.id}`,
      })),
    };
  },
};

registerTool(searchProducts);
