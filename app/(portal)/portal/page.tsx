import { SignIn } from "@clerk/nextjs";
import { BrandMark } from "@/components/brand-mark";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { portalIdentity } from "./guard";

/**
 * Portal entry point. Signed-out visitors get an email-link-only sign-in; signed-in
 * ones are matched to their `customers` row by Clerk user ID and sent straight to
 * their quotation.
 */
export default async function PortalPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark size="lg" orientation="column" priority />
          <p className="text-xs text-muted-foreground font-medium">Customer Portal Access</p>
        </div>
        <SignIn
          routing="hash"
          appearance={{
            elements: {
              // Email link is the only supported factor for portal customers —
              // hide every alternative the Clerk instance might still offer.
              socialButtonsRoot: "hidden",
              dividerRow: "hidden",
              alternativeMethods: "hidden",
              footerAction: "hidden",
              formFieldRow__password: "hidden",
            },
          }}
        />
      </main>
    );
  }

  // Resolves the Clerk user to their customer row, and refuses anyone who is
  // not a portal customer.
  const access = await portalIdentity();

  if (!access.ok) {
    return (
      <PortalNotice
        title={
          access.reason === "notCustomer"
            ? "This account is not a portal account"
            : "No portal account linked"
        }
      />
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id")
    .eq("customer_id", access.identity.customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (quotationError) {
    throw new Error(`Failed to load quotation: ${quotationError.message}`);
  }

  if (!quotation) {
    return <PortalNotice title="No quotation is ready for you yet" />;
  }

  redirect(`/portal/${quotation.id}`);
}

function PortalNotice({ title }: { title: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center flex flex-col items-center">
        <div className="mb-5 flex flex-col items-center gap-2">
          <BrandMark size="md" orientation="column" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Please contact your account manager if you believe this is a mistake.
        </p>
      </div>
    </main>
  );
}
