import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import {
  INVOICE_STAGES,
  INVOICE_STAGE_LABELS,
  invoiceStage,
} from "@/lib/business-logic";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { cn } from "@/lib/utils";
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
import { InvoiceActions } from "./invoice-actions";

/** Screen 13 — one invoice, its lifecycle, its lines and its payments. */

type InvoiceDetail = {
  id: string;
  reference: string | null;
  kind: "one_time" | "recurring";
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  total: number;
  amount_paid: number;
  status: string;
  issued_at: string;
  orders: {
    id: string;
    reference: string | null;
    quotation_id: string | null;
    customers: { name: string | null } | null;
  } | null;
  invoice_lines: {
    id: string;
    description: string;
    qty: number;
    unit_price: number;
    amount: number;
  }[];
  payments: {
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    recorded_at: string;
  }[];
};

export default async function InvoiceDetailPage({
  params,
}: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const actor = await requireModule("billing");
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `id, reference, kind, period_start, period_end, due_date, total,
       amount_paid, status, issued_at,
       orders(id, reference, quotation_id, customers(name)),
       invoice_lines(id, description, qty, unit_price, amount),
       payments(id, amount, method, reference, recorded_at)`,
    )
    .eq("id", id)
    .maybeSingle<InvoiceDetail>();

  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!data) notFound();

  // Delivery is read from the order's allocations, so the stepper says
  // "shipped" only when stock has actually been committed against it.
  const { ordered, allocated } = await deliveryProgress(
    supabase,
    data.orders?.quotation_id ?? null,
  );

  const stage = invoiceStage({
    kind: data.kind,
    amountPaid: Number(data.amount_paid),
    total: Number(data.total),
    allocatedUnits: allocated,
    orderedUnits: ordered,
  });

  const outstanding = Math.max(0, Number(data.total) - Number(data.amount_paid));

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={`Invoice ${data.reference ?? data.id.slice(0, 8)}`}
        caption={data.orders?.customers?.name ?? "Unassigned customer"}
        badge={data.kind === "recurring" ? "Subscription" : "One-time"}
      >
        <Link
          href="/invoices"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Invoices
        </Link>
      </PageHeader>

      <Stepper stage={stage} />

      <Panel delay={80}>
        <PanelHeader
          icon={ReceiptIcon}
          title="Lines"
          caption={
            data.period_start
              ? `Covers ${data.period_start} → ${data.period_end}`
              : `Due ${data.due_date ?? "—"}`
          }
        />

        <div className="mt-3">
          <DataTable
            minWidth="34rem"
            head={
              <>
                <Th>Description</Th>
                <Th className="w-20">Qty</Th>
                <Th className="w-28 text-right">Unit</Th>
                <Th className="w-28 text-right">Amount</Th>
              </>
            }
          >
            {data.invoice_lines.map((line) => (
              <Tr key={line.id}>
                <Td className="font-medium">{line.description}</Td>
                <Td className="tabular-nums">{Number(line.qty)}</Td>
                <Td className="text-right tabular-nums">
                  {formatCurrency(Number(line.unit_price))}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(Number(line.amount))}
                </Td>
              </Tr>
            ))}

            {data.invoice_lines.length === 0 ? (
              <EmptyRow colSpan={4}>This invoice has no lines.</EmptyRow>
            ) : null}
          </DataTable>
        </div>

        <dl className="mt-4 flex flex-wrap gap-6 border-t border-border/60 pt-3">
          <Figure label="Total" value={formatCurrency(Number(data.total))} />
          <Figure label="Paid" value={formatCurrency(Number(data.amount_paid))} />
          <Figure label="Outstanding" value={formatCurrency(outstanding)} strong />
        </dl>
      </Panel>

      <InvoiceActions
        invoiceId={data.id}
        outstanding={outstanding}
        recurring={data.kind === "recurring"}
        settled={data.status === "paid" || data.status === "void"}
        canWrite={actor.canWrite}
      />

      <Panel delay={160}>
        <PanelHeader
          icon={ReceiptIcon}
          title="Payments"
          caption={`${data.payments.length} recorded`}
        />

        <div className="mt-3">
          <DataTable
            minWidth="34rem"
            head={
              <>
                <Th>Recorded</Th>
                <Th className="w-32">Method</Th>
                <Th>Reference</Th>
                <Th className="w-28 text-right">Amount</Th>
              </>
            }
          >
            {data.payments.map((payment) => (
              <Tr key={payment.id}>
                <Td className="text-muted-foreground">
                  {new Date(payment.recorded_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </Td>
                <Td className="capitalize">{payment.method.replace(/_/g, " ")}</Td>
                <Td className="text-muted-foreground">{payment.reference ?? "—"}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(Number(payment.amount))}
                </Td>
              </Tr>
            ))}

            {data.payments.length === 0 ? (
              <EmptyRow colSpan={4}>Nothing paid against this invoice yet.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      {stage === "confirmed" ? (
        <Notice>
          Nothing has shipped against this order yet. Partial invoicing stays
          reconciled with partial delivery — the stepper only reaches Invoiced once
          stock is committed in Fulfillment.
        </Notice>
      ) : null}
    </main>
  );
}

/** Ordered and allocated units on the quotation behind this invoice. */
async function deliveryProgress(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  quotationId: string | null,
) {
  if (!quotationId) return { ordered: 0, allocated: 0 };

  const [lines, allocations] = await Promise.all([
    supabase
      .from("quotation_lines")
      .select("qty")
      .eq("quotation_id", quotationId)
      .returns<{ qty: number }[]>(),
    supabase
      .from("quotation_allocations")
      .select("qty")
      .eq("quotation_id", quotationId)
      .returns<{ qty: number }[]>(),
  ]);

  const sum = (rows: { qty: number }[] | null) =>
    (rows ?? []).reduce((total, row) => total + Number(row.qty), 0);

  return { ordered: sum(lines.data), allocated: sum(allocations.data) };
}

function Stepper({ stage }: { stage: (typeof INVOICE_STAGES)[number] }) {
  const reached = INVOICE_STAGES.indexOf(stage);

  return (
    <Panel>
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {INVOICE_STAGES.map((step, index) => {
          const done = index <= reached;

          return (
            <li key={step} className="flex items-center gap-3">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-6 rounded-full ring-1",
                    done
                      ? "bg-emerald-500/15 ring-emerald-500/40"
                      : "bg-muted ring-border",
                  )}
                />
                <span
                  className={cn(
                    "text-xs",
                    done ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {INVOICE_STAGE_LABELS[step]}
                </span>
              </span>
              {index < INVOICE_STAGES.length - 1 ? (
                <span className="h-px w-8 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "text-sm font-semibold" : "text-sm",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
