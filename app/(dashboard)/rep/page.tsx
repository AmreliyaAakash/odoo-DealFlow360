import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { loadRepDashboard } from "./data";
import { RepDashboard } from "./rep-dashboard";

/** The sales rep's home screen. Navigation lives in the dashboard layout. */
export default async function RepDashboardPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const data = await loadRepDashboard(userId);

  return <RepDashboard data={data} />;
}
