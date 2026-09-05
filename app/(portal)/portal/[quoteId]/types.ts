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
  validUntil: string | null;
  notes: string | null;
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  lines: PortalLine[];
};

/** Sky is the portal's accent, distinct from every internal workspace. */
export const PORTAL_ACCENT = "#0ea5e9";
