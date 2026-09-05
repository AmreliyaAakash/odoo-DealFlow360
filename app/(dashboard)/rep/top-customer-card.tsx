"use client";

import { CheckIcon, CrownSimpleIcon } from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { TopCustomer } from "./types";

export function TopCustomerCard({ customer }: { customer: TopCustomer | null }) {
  return (
    <section
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "350ms" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <CrownSimpleIcon size={16} weight="fill" className="text-amber-500" />
        <h2 className="text-sm font-semibold">Top Customer</h2>
      </div>

      {customer === null ? (
        <p className="mt-4 text-xs text-muted-foreground">No active deals yet.</p>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium">{customer.name}</p>
          <p className="text-[11px] text-muted-foreground">{customer.reference}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(customer.amount)}
          </p>

          <ol className="mt-4 flex flex-col">
            {customer.steps.map((step, index) => {
              const last = index === customer.steps.length - 1;

              return (
                <li key={step.key} className="flex gap-3">
                  {/* Rail: marker plus the connector down to the next step. */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                        step.done
                          ? "df-check-in bg-indigo-500 text-white"
                          : "bg-muted text-muted-foreground ring-1 ring-border",
                      )}
                      style={
                        { "--df-delay": `${450 + index * 220}ms` } as React.CSSProperties
                      }
                      aria-hidden
                    >
                      {step.done ? <CheckIcon size={11} weight="bold" /> : index + 1}
                    </span>

                    {last ? null : (
                      <span
                        className={cn(
                          "w-px flex-1",
                          step.done ? "bg-indigo-500" : "bg-border",
                        )}
                      />
                    )}
                  </div>

                  <div className={cn(!last && "pb-4")}>
                    <p
                      className={cn(
                        "text-xs",
                        step.done ? "font-medium" : "text-muted-foreground",
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {step.done ? "Complete" : "Pending"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
