import Image from "next/image";
import { SignIn } from "@clerk/nextjs";
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
          <div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-950 p-2.5 shadow-md dark:bg-zinc-100">
            <Image
              src="/icon.png"
              alt="DealFlow360 Icon"
              width={48}
              height={48}
              className="size-9 object-contain invert dark:invert-0"
              priority
            />
          </div>
          <Image
            src="/logo.png"
            alt="DealFlow360"
            width={200}
            height={36}
            className="h-8 w-auto object-contain dark:invert"
            priority
          />
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
          <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-950 p-2 shadow-sm dark:bg-zinc-100">
            <Image
              src="/icon.png"
              alt="DealFlow360 Icon"
              width={40}
              height={40}
              className="size-7 object-contain invert dark:invert-0"
            />
          </div>
          <Image
            src="/logo.png"
            alt="DealFlow360"
            width={160}
            height={30}
            className="h-6.5 w-auto object-contain dark:invert"
          />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Please contact your account manager if you believe this is a mistake.
        </p>
      </div>
    </main>
  );
}
