"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRightIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { DataTable, EmptyRow, Panel, PanelHeader, Td, Th, Tr } from "@/components/dashboard/panel";
import { ACTION_STYLES, ENTITY_LABELS, type AuditLogRow } from "./types";

/** Most rows the feed holds before the oldest are dropped. */
const MAX_ROWS = 50;

/**
 * The config audit trail. Seeded server-side, then kept live by a realtime
 * subscription — new entries slide in at the top as they are written.
 */
export function AuditLog({ initial }: { initial: AuditLogRow[] }) {
  const supabase = useSupabase();
  const [rows, setRows] = useState(initial);
  const [live, setLive] = useState(false);

  // Ids that arrived over the wire, so only those slide in. Rows present on the
  // first paint use the page's own stagger instead.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const channel = supabase
      .channel("admin-config-audit")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "config_audit_log" },
        (payload) => {
          const row = payload.new as AuditLogRow | undefined;
          if (!row?.id) return;

          setArrived((current) => new Set(current).add(row.id));
          setRows((current) =>
            current.some((existing) => existing.id === row.id)
              ? current
              : [row, ...current].slice(0, MAX_ROWS),
          );
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return (
    <Panel delay={320}>
      <PanelHeader
        icon={ClockCounterClockwiseIcon}
        title="Recent Config Changes"
        caption="Who changed what, and what it was before"
      >
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
            live
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "animate-pulse bg-violet-500" : "bg-muted-foreground/50",
            )}
          />
          {live ? "Live" : "Connecting"}
        </span>
      </PanelHeader>

      <div className="mt-3">
        <DataTable
          minWidth="48rem"
          head={
            <>
              <Th className="w-44">Who</Th>
              <Th>What Changed</Th>
              <Th className="w-72">Old Value → New Value</Th>
              <Th className="w-32 text-right">Timestamp</Th>
            </>
          }
        >
          {rows.map((row, index) => (
            <Tr
              key={row.id}
              className={arrived.has(row.id) ? "df-slide-in-top" : "df-rise-in"}
              style={
                arrived.has(row.id)
                  ? undefined
                  : ({ "--df-delay": `${index * 35}ms` } as React.CSSProperties)
              }
            >
              <Td className="font-medium">
                <span className="block truncate">
                  {row.actor_name ?? shortId(row.actor_id)}
                </span>
                <span className="block truncate text-[10px] font-normal text-muted-foreground">
                  {shortId(row.actor_id)}
                </span>
              </Td>

              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                      ACTION_STYLES[row.action] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.action}
                  </span>
                  <span className="text-muted-foreground">
                    {ENTITY_LABELS[row.entity] ?? row.entity}
                  </span>
                  {row.entity_label ? (
                    <span className="font-medium">{row.entity_label}</span>
                  ) : null}
                  {row.field ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {row.field}
                    </span>
                  ) : null}
                </span>
              </Td>

              <Td>
                {row.field === null ? (
                  <span className="text-muted-foreground">Whole record</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="max-w-[9rem] truncate text-muted-foreground line-through decoration-muted-foreground/40">
                      {row.old_value ?? "—"}
                    </span>
                    <ArrowRightIcon
                      size={11}
                      className="shrink-0 text-violet-500"
                      weight="bold"
                    />
                    <span className="max-w-[9rem] truncate font-medium">
                      {row.new_value ?? "—"}
                    </span>
                  </span>
                )}
              </Td>

              <Td className="text-right whitespace-nowrap text-muted-foreground">
                <RelativeTime iso={row.created_at} />
              </Td>
            </Tr>
          ))}

          {rows.length === 0 ? (
            <EmptyRow colSpan={4}>No configuration changes recorded yet.</EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

/** Re-reads the clock every minute so "2 minutes ago" does not go stale. */
const subscribeToMinute = (onChange: () => void) => {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
};

/** Bucketed to the minute, so the snapshot is stable between renders. */
const currentMinute = () => Math.floor(Date.now() / 60_000);

/** No clock on the server: relative time is rendered only once hydrated. */
const noMinute = () => null;

/**
 * A relative time formatted on the server is already stale by the time it
 * reaches the browser, which React reports as a hydration mismatch. Subscribing
 * to the clock instead means the server and the first client render agree, and
 * the label refreshes on its own thereafter.
 */
function RelativeTime({ iso }: { iso: string }) {
  const minute = useSyncExternalStore(subscribeToMinute, currentMinute, noMinute);

  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-IN")}>
      {minute === null ? "—" : formatDistanceToNow(new Date(iso), { addSuffix: true })}
    </time>
  );
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}
