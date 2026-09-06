"use client";

import { SignIn } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/auth/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell heading="Welcome back" subheading="Sign in to your DealFlow360 workspace">
      <SignIn appearance={authAppearance} />
    </AuthShell>
  );
}
