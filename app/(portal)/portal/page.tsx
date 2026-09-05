import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Portal entry point. Signed-out visitors get an email-link-only sign-in; signed-in
 * ones are matched to their `customers` row by Clerk user ID and sent straight to
 * their quotation.
 */
export default async function PortalPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
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

  const supabase = createServerSupabaseClient();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("portal_user_id", userId)
    .maybeSingle();

  if (customerError) {
    throw new Error(`Failed to load customer: ${customerError.message}`);
  }

  if (!customer) {
    return <PortalNotice title="No portal account linked" />;
  }

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id")
    .eq("customer_id", customer.id)
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
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Please contact your account manager if you believe this is a mistake.
        </p>
      </div>
    </main>
  );
}
