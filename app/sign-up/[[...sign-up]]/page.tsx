"use client";

import { SignUp } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/auth/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell heading="Build smarter deals" subheading="Create your DealFlow360 workspace">
      <SignUp appearance={authAppearance} />
    </AuthShell>
  );
}
