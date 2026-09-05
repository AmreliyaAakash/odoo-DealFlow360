import { EntityPage } from "../_entity-page";

/**
 * Upsell rules — which product to suggest alongside which.
 *
 * Now a full config screen rather than the read-only listing it used to be: the
 * rules table is half of what the suggestion engine ranks (the other half is
 * mined from past quotations), so a desk that cannot edit it can only wait for
 * history to catch up.
 */
export default function Page() {
  return <EntityPage entity="upsell-rules" />;
}
