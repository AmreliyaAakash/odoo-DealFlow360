"use client";

import { useState } from "react";
import { ChatCircleIcon, UserCircleIcon } from "@phosphor-icons/react";
import { NegotiationThread, type NegotiationHandle } from "./negotiation-thread";
import { PORTAL_ACCENT, type PortalProfile } from "./types";

/**
 * Screen 11 — the column beside the quote: the conversation, or the account.
 *
 * Tabs rather than two stacked panels because the thread needs the height. A
 * profile card is read once, at the start; the conversation is read every time
 * the customer comes back, so it gets the space by default.
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
  const [tab, setTab] = useState<"messages" | "profile">("messages");

  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label="Quote sidebar"
        className="flex gap-1 rounded-xl bg-muted/60 p-1"
      >
        <Tab
          label="Messages"
          icon={ChatCircleIcon}
          active={tab === "messages"}
          onClick={() => setTab("messages")}
        />
        <Tab
          label="Profile"
          icon={UserCircleIcon}
          active={tab === "profile"}
          onClick={() => setTab("profile")}
        />
      </div>

      {/* The thread stays mounted across tabs. Unmounting it would drop an
          unsent draft and re-fetch the conversation every time somebody
          glanced at their address. */}
      <div hidden={tab !== "messages"}>
        <NegotiationThread ref={threadRef} quoteId={quoteId} readOnly={readOnly} />
      </div>

      {tab === "profile" ? <ProfileCard profile={profile} /> : null}
    </div>
  );
}

function Tab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { background: "var(--card)", color: PORTAL_ACCENT }
          : { color: "var(--muted-foreground)" }
      }
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function ProfileCard({ profile }: { profile: PortalProfile }) {
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">{profile.name}</h2>
      <p className="text-[11px] capitalize text-muted-foreground">
        {profile.tier} account
      </p>

      <dl className="mt-4 flex flex-col gap-3">
        <Row label="Email" value={profile.email} />
        <Row label="Phone" value={profile.phone} />
        <Row label="Delivery address" value={profile.address} />
      </dl>

      <p className="mt-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        Something out of date? Send a message on the Messages tab and your
        account manager will update it.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-xs whitespace-pre-wrap">
        {value ?? <span className="text-muted-foreground">Not on file</span>}
      </dd>
    </div>
  );
}
