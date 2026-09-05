import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { Scope } from "@/lib/permissions";
import { QUOTATION_STATUSES, statusLabel } from "@/lib/status";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** Everything the filter dropdowns need, resolved server-side. */

export type Option = { value: string; label: string };

export type ReportOptions = {
  periods: Option[];
  reps: Option[];
  statuses: Option[];
  products: Option[];
  /** An own-scoped caller has no rep choice to make. */
  canChooseRep: boolean;
};

/** Rolling presets first, then the last twelve calendar months. */
function periodOptions(): Option[] {
  const options: Option[] = [
    { value: "all", label: "All time" },
    { value: "last30", label: "Last 30 days" },
    { value: "last90", label: "Last 90 days" },
    { value: "ytd", label: "Year to date" },
  ];

  const now = new Date();
  for (let back = 0; back < 12; back += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    options.push({
      value: `${date.getFullYear()}-${month}`,
      label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    });
  }

  return options;
}

export async function loadReportOptions(scope: Scope): Promise<ReportOptions> {
  const supabase = createServerSupabaseClient();

  const [products, quotations] = await Promise.all([
    supabase
      .from("products")
      .select("sku, name")
      .eq("active", true)
      .order("name")
      .returns<{ sku: string | null; name: string }[]>(),
    // Only the reps who actually own quotations — a dropdown of every Clerk
    // user would list people who have never raised one.
    supabase
      .from("quotations")
      .select("rep_id")
      .limit(2000)
      .returns<{ rep_id: string }[]>(),
  ]);

  const canChooseRep = scope !== "own";

  return {
    periods: periodOptions(),
    reps: canChooseRep ? await repOptions(quotations.data ?? []) : [],
    statuses: QUOTATION_STATUSES.map((status) => ({
      value: status,
      label: statusLabel(status),
    })),
    products: (products.data ?? [])
      .filter((product): product is { sku: string; name: string } => Boolean(product.sku))
      .map((product) => ({ value: product.sku, label: product.name })),
    canChooseRep,
  };
}

async function repOptions(rows: { rep_id: string }[]): Promise<Option[]> {
  const ids = [...new Set(rows.map((row) => row.rep_id))].filter(Boolean);
  if (ids.length === 0) return [];

  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      userId: ids,
      limit: Math.min(ids.length, 500),
    });

    const named = new Map(
      data.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.emailAddresses[0]?.emailAddress ||
          user.id,
      ]),
    );

    return ids
      .map((id) => ({ value: id, label: named.get(id) ?? shortId(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return ids.map((id) => ({ value: id, label: shortId(id) }));
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}
