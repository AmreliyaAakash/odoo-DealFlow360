"use client";

import { EnvelopeSimpleIcon, MapPinIcon, PhoneIcon } from "@phosphor-icons/react";
import {
  NegotiationThread,
  type NegotiationHandle,
} from "@/components/negotiation/negotiation-thread";
import type { PortalProfile } from "./types";

/**
 * The column beside the quote: the conversation, the account it is for, and
 * where to turn for help.
 *
 * Stacked rather than tabbed. Tabs hid the account details behind a click that
 * nobody made, and a portal that asks you to hunt for your own address does not
 * feel like one you can trust with a purchase order. The thread has a bounded
 * height of its own, so stacking costs nothing on a wide screen.
 */
export function SidePanel({
  quoteId,
  readOnly,
  profile,
  threadRef,
}: {
  quoteId: string;
  readOnly: boolean;
  profile: PortalProfile;
  threadRef: React.Ref<NegotiationHandle>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div id="messages">
        <NegotiationThread
          ref={threadRef}
          quotationId={quoteId}
          viewpoint="customer"
          canPost={!readOnly}
          closedReason={
            readOnly
              ? "This quotation is settled, so the conversation is read-only."
              : undefined
          }
          className="shadow-sm"
        />
      </div>

      <section className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10">
        <header className="border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold">Account</h2>
          <p className="text-[11px] text-muted-foreground">Where this quotation is going</p>
        </header>

        <dl className="flex flex-col gap-3 p-5">
          <div>
            <dt className="text-[11px] text-muted-foreground">Organisation</dt>
            <dd className="text-xs font-medium">
              {profile.name}
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                {profile.tier}
              </span>
            </dd>
          </div>
          <Row icon={EnvelopeSimpleIcon} label="Email" value={profile.email} />
          <Row icon={PhoneIcon} label="Phone" value={profile.phone} />
          <Row icon={MapPinIcon} label="Delivery address" value={profile.address} />
        </dl>

        <p className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
          Something out of date? Send a message and your account manager will
          update it before anything ships.
        </p>
      </section>

      <section
        id="help"
        className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10"
      >
        <header className="border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold">Need help?</h2>
        </header>
        <div className="flex flex-col gap-2 p-5 text-xs text-muted-foreground">
          <p>
            Your account manager reads every message on this quotation and
            replies here — there is no separate inbox to check.
          </p>
          <p>
            To change a quantity or a price, use{" "}
            <span className="font-medium text-foreground">Propose change</span> on
            the line itself; it lands in the same conversation with the figures
            attached.
          </p>
          {readOnly ? null : (
            <a
              href="#messages"
              className="mt-1 inline-flex w-fit items-center rounded-lg bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
            >
              Write a message
            </a>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="text-xs whitespace-pre-wrap">
          {value ?? <span className="text-muted-foreground">Not on file</span>}
        </dd>
      </div>
    </div>
  );
}
