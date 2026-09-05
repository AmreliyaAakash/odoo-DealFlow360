import Link from "next/link";
import { PercentIcon, SquaresFourIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import {
  APPROVAL_RULES,
  CUSTOMER_TIERS,
  TIER_LABELS,
  type ApprovalLevel,
  type CustomerTier,
  type DiscountRule,
} from "@/lib/business-logic";
import { requireModule } from "@/lib/page-guard";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/**
 * Screen 18 — the governance the whole product runs on, on one page.
 *
 * Three tables because the desk asks three separate questions: how deep may
 * this customer go, how deep may this kind of product go, and who has to sign
 * when someone goes deeper. Split across generic config screens those questions
 * can be answered inconsistently without anybody noticing; side by side, a
 * Services ceiling above the Gold ceiling is visible immediately.
 *
 * Read-only by design. The rules are edited on the config screen this links to,
 * and duplicating that editor here would give the same rule two owners.
 */

const CHAIN: Record<ApprovalLevel, string> = {
  manager: "Sales manager",
  finance: "Sales manager, then finance",
  admin: "Sales manager, finance, then admin",
};

type RuleRow = DiscountRule & {
  id: string;
  name: string;
  approval_level: string;
};

export default async function DiscountSetupPage() {
  const actor = await requireModule("discountRules");
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("discount_rules")
    .select("id, name, scope, scope_ref, customer_tier, max_discount_pct, approval_level")
    .eq("active", true)
    .order("max_discount_pct", { ascending: true })
    .returns<RuleRow[]>();

  const rules = data ?? [];

  // A rule pinned to a tier answers "how deep may this customer go"; one pinned
  // to a category answers "how deep may this kind of product go". Global rules
  // are the escalation bands, which is the third table.
  const tierRules = rules.filter((rule) => rule.customer_tier !== null);
  const categoryRules = rules.filter(
    (rule) => rule.customer_tier === null && rule.scope === "category",
  );
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Discount tiers and approval chains"
        caption="Ceilings per customer tier and per product category, and who signs when a quote goes past them"
        badge="Governance"
      >
        {actor.canWrite ? (
          <Link
            href="/backend/discount-rules"
            className="flex h-8 items-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Edit rules
          </Link>
        ) : null}
      </PageHeader>

      {error ? <Notice tone="danger">{error.message}</Notice> : null}

      <Panel>
        <PanelHeader
          icon={PercentIcon}
          title="Tier discount ceilings"
          caption="The deepest a rep may go for this customer without escalating"
        />

        <div className="mt-3">
          <DataTable
            minWidth="34rem"
            head={
              <>
                <Th>Tier</Th>
                <Th>Applies to</Th>
                <Th className="w-32 text-right">Max discount</Th>
                <Th className="w-32">Escalates to</Th>
              </>
            }
          >
            {tierRules.map((rule) => (
              <Tr key={rule.id}>
                <Td className="font-medium">
                  {TIER_LABELS[rule.customer_tier as CustomerTier] ??
                    rule.customer_tier}
                </Td>
                <Td className="text-muted-foreground">
                  {rule.scope_ref ?? "Everything"}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {Number(rule.max_discount_pct).toFixed(0)}%
                </Td>
                <Td className="capitalize text-muted-foreground">
                  {rule.approval_level}
                </Td>
              </Tr>
            ))}

            {tierRules.length === 0 ? (
              <EmptyRow colSpan={4}>
                No tier ceilings set — every tier falls back to the bands below.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <Panel delay={80}>
        <PanelHeader
          icon={SquaresFourIcon}
          title="Category discount ceilings"
          caption="Thin-margin categories carry a stricter limit than the customer's tier"
        />

        <div className="mt-3">
          <DataTable
            minWidth="34rem"
            head={
              <>
                <Th>Category</Th>
                <Th className="w-32 text-right">Max discount</Th>
                <Th className="w-32">Escalates to</Th>
              </>
            }
          >
            {categoryRules.map((rule) => (
              <Tr key={rule.id}>
                <Td className="font-medium">{rule.scope_ref ?? "—"}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {Number(rule.max_discount_pct).toFixed(0)}%
                </Td>
                <Td className="capitalize text-muted-foreground">
                  {rule.approval_level}
                </Td>
              </Tr>
            ))}

            {categoryRules.length === 0 ? (
              <EmptyRow colSpan={3}>No category ceilings set.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <Panel delay={140}>
        <PanelHeader
          icon={StackIcon}
          title="Approval chain"
          caption="Which desk signs, by how far past the ceiling a quote goes"
        />

        <div className="mt-3">
          <DataTable
            minWidth="40rem"
            head={
              <>
                <Th>When it trips</Th>
                <Th className="w-56">Approval chain</Th>
                <Th className="w-28">Signs off</Th>
              </>
            }
          >
            <Tr>
              <Td className="font-medium">Within tier and category limit</Td>
              <Td className="text-muted-foreground">No approval needed</Td>
              <Td className="text-[11px] text-muted-foreground">Nobody</Td>
            </Tr>

            {/* Read from APPROVAL_RULES rather than typed out, so this screen
                cannot describe a chain the router does not actually run. */}
            {APPROVAL_RULES.map((rule) => (
              <Tr key={rule.reason}>
                <Td className="font-medium">{rule.reason}</Td>
                <Td className="text-muted-foreground">{CHAIN[rule.level]}</Td>
                <Td className="text-[11px] capitalize text-muted-foreground">
                  {rule.level}
                </Td>
              </Tr>
            ))}
          </DataTable>
        </div>

        <div className="mt-3">
          <Notice>
            A quote mixing categories is scored against every line&apos;s own
            ceiling and routed to the highest level any of them requires. Every
            approval, rejection and edit is logged with user, timestamp and
            reason on the quotation&apos;s approval screen.
          </Notice>
        </div>
      </Panel>

      <Panel delay={200}>
        <PanelHeader
          icon={PercentIcon}
          title="Tiers in use"
          caption="The commercial tiers a customer can be placed on"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {CUSTOMER_TIERS.map((tier) => (
            <span
              key={tier}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium"
            >
              {TIER_LABELS[tier]}
            </span>
          ))}
        </div>
      </Panel>
    </main>
  );
}
