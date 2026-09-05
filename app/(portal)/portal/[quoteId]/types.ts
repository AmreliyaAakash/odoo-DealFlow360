/** View models for the customer portal. Nothing internal leaks into these. */

import type { PortalStage } from "@/lib/business-logic";

export type PortalLine = {
  id: string;
  productName: string;
  category: string;
  sku: string | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  /** Price after this line's discount. */
  net: number;
};

export type PortalQuote = {
  id: string;
  reference: string;
  customerName: string;
  stage: PortalStage;
  /** True for a rejected or lost quotation; the stepper stops. */
  closedLost: boolean;
  /**
   * What the customer may do, as three plain facts rather than the internal
   * status. A portal user has no business knowing a deal is "pending_approval",
   * only that it is with us and not yet theirs to accept.
   */
  canConfirm: boolean;
  awaitingDesk: boolean;
  settled: boolean;
  /** Deepest discount currently on the quotation, so a counter can beat it. */
  maxDiscountPct: number;
  /** What the customer asked for at confirmation, if anything. */
  requestedDeliveryDate: string | null;
  /** The account this quote belongs to, as the Profile tab shows it back. */
  profile: PortalProfile;
  validUntil: string | null;
  notes: string | null;
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  lines: PortalLine[];
};

/**
 * The customer's own account details.
 *
 * Shown so a customer can check the quote is going to the right place before
 * they confirm it — a wrong address found after confirmation is a shipment to
 * chase, not a field to edit. Read-only here: changing an account is a
 * conversation with the account manager, and the thread beside it is where that
 * conversation already lives.
 */
export type PortalProfile = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tier: string;
};

/** Sky is the portal's accent, distinct from every internal workspace. */
export const PORTAL_ACCENT = "#0ea5e9";
