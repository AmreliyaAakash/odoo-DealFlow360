import { requireModule } from "@/lib/page-guard";
import { loadRepDashboard } from "./data";
import { RepDashboard } from "./rep-dashboard";

/**
 * The sales rep's home screen. Navigation lives in the dashboard layout.
 *
 * Everything on it is quotation data, so it is gated on `quotationBuilder`
 * rather than on the rep role: an account that has had the module revoked must
 * not reach its own pipeline chart by typing the URL, and one that has been
 * granted it should.
 */
export default async function RepDashboardPage() {
  const actor = await requireModule("quotationBuilder");

  const data = await loadRepDashboard(actor.userId);

  return <RepDashboard data={data} />;
}
