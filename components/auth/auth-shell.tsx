"use client";

import Link from "next/link";
import Image from "next/image";
import { Inter } from "next/font/google";
import { SignIn, useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

import { DealEngine } from "./deal-engine";
import styles from "./auth-shell.module.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

/**
 * Appearance handed to Clerk's `<SignIn>` / `<SignUp>` so the form it renders
 * sits inside the dark glass card as if it were hand-built. Only presentation:
 * the auth flow (email code, password, OAuth, captcha) is untouched.
 */
export const authAppearance: NonNullable<React.ComponentProps<typeof SignIn>["appearance"]> = {
  variables: {
    colorPrimary: "#33c8e8",
    colorPrimaryForeground: "#04141a",
    colorBackground: "#0c1016",
    colorForeground: "#f2f4f7",
    colorMutedForeground: "#98a2b3",
    colorMuted: "rgba(255,255,255,0.045)",
    colorInput: "rgba(255,255,255,0.02)",
    colorInputForeground: "#f2f4f7",
    colorNeutral: "#f2f4f7",
    colorBorder: "rgba(255,255,255,0.12)",
    colorDanger: "#e8b95c",
    colorSuccess: "#34d399",
    borderRadius: "8px",
    fontFamily: "inherit",
    fontFamilyButtons: "inherit",
  },
  elements: {
    rootBox: styles.clerkRoot,
    cardBox: styles.clerkCard,
    card: styles.clerkCard,
    main: styles.clerkRoot,
    headerTitle: styles.clerkHidden,
    headerSubtitle: styles.clerkHidden,
    logoBox: styles.clerkHidden,
    formHeaderTitle: styles.clerkHidden,
    formHeaderSubtitle: styles.clerkHidden,
    formFieldLabel: styles.clerkLabel,
    formFieldInput: styles.clerkInput,
    formFieldInputGroup: styles.clerkInputGroup,
    formFieldInputShowPasswordButton: styles.clerkShowPassword,
    formFieldAction: styles.clerkLink,
    formFieldErrorText: styles.clerkErrorText,
    formFieldHintText: styles.clerkMuted,
    formButtonPrimary: styles.clerkPrimary,
    socialButtonsBlockButton: styles.clerkSocial,
    socialButtonsBlockButtonText: styles.clerkSocialText,
    dividerLine: styles.clerkDividerLine,
    dividerText: styles.clerkDividerText,
    footer: styles.clerkFooter,
    footerItem: styles.clerkFooterItem,
    footerAction: styles.clerkFooterItem,
    footerActionText: styles.clerkFooterText,
    footerActionLink: styles.clerkFooterLink,
    footerPages: styles.clerkHidden,
    alert: styles.clerkAlert,
    alertText: styles.clerkAlertText,
    identityPreviewText: styles.clerkMuted,
    identityPreviewEditButton: styles.clerkFooterLink,
    formResendCodeLink: styles.clerkFooterLink,
    alternativeMethodsBlockButton: styles.clerkSocial,
    backLink: styles.clerkLink,
    otpCodeFieldInput: styles.clerkOtpInput,
  },
};

/**
 * The two-panel auth screen. Left: brand, heading and whatever form is passed
 * as children (Clerk's). Right: the 3D deal engine with data cards and copy.
 *
 * The engine "ignites" when Clerk reports a session — that is the moment the
 * form has succeeded and the redirect is about to happen.
 */
export function AuthShell({
  heading,
  subheading,
  children,
}: {
  heading: string;
  subheading: string;
  children: React.ReactNode;
}) {
  const { isSignedIn } = useAuth();
  const centerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The screen must never scroll. When the window is too short for the card
  // (a small laptop, or a zoomed-in browser), the card is scaled down to the
  // space available rather than overflowing. Clerk swaps the form's contents
  // between steps, so both the slot and the card are observed.
  useEffect(() => {
    const center = centerRef.current;
    const card = cardRef.current;
    if (!center || !card) return;

    const fit = () => {
      // Stacked (narrow) layout scrolls normally; the CSS disables the scale.
      if (window.innerWidth <= 900) {
        card.style.removeProperty("--fit");
        return;
      }
      const available = center.clientHeight;
      const needed = card.offsetHeight; // unaffected by the transform
      const scale = needed > 0 ? Math.min(1, available / needed) : 1;
      card.style.setProperty("--fit", scale.toFixed(4));
    };

    const ro = new ResizeObserver(fit);
    ro.observe(center);
    ro.observe(card);
    fit();
    return () => ro.disconnect();
  }, []);

  return (
    <main className={`${styles.page} ${inter.className}`}>
      <section className={styles.authPanel}>
        <Link href="/" className={styles.brand} aria-label="DealFlow360 home">
          <Image
            src="/icon.png"
            alt=""
            width={48}
            height={48}
            className={styles.brandMark}
            priority
          />
          <Image
            src="/logo.png"
            alt="DealFlow360"
            width={220}
            height={40}
            className={styles.brandName}
            priority
          />
        </Link>

        <div ref={centerRef} className={styles.authCenter}>
          <div ref={cardRef} className={styles.authCard}>
            <h1 className={styles.heading}>{heading}</h1>
            <p className={styles.subheading}>{subheading}</p>

            {children}

            {/*
              Smart CAPTCHA (Cloudflare Turnstile) needs a visible mount point.
              Without one Clerk cannot resolve the challenge, and the social
              buttons hang on their spinner instead of redirecting.
            */}
            <div id="clerk-captcha" className={styles.captcha} />
          </div>
        </div>

        <p className={styles.footNote}>
          <Link href="/">&larr; Return to DealFlow360 home</Link>
        </p>
      </section>

      <section className={styles.enginePanel} aria-label="DealFlow360 deal engine">
        <DealEngine
          ignite={Boolean(isSignedIn)}
          className={styles.engineCanvas}
          fallbackClassName={styles.engineFallback}
        />

        <div className={`${styles.dataCard} ${styles.c1}`} aria-hidden="true">
          <strong>Margin +8.4%</strong>Deal DF-2841
        </div>
        <div className={`${styles.dataCard} ${styles.c2}`} aria-hidden="true">
          <strong>Approval needed</strong>Manager and Finance
        </div>
        <div className={`${styles.dataCard} ${styles.c3}`} aria-hidden="true">
          <strong>&#8377;18,60,000 order</strong>Split across 3 warehouses
        </div>

        <div className={styles.engineCopy}>
          <p className={styles.engineHeadline}>From quotation to cash, intelligently governed.</p>
          <div className={styles.chips} aria-hidden="true">
            <span className={styles.chip}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b7cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
              </svg>
              Margin Protection
            </span>
            <span className={styles.chip}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b7cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
              </svg>
              Smart Approvals
            </span>
            <span className={styles.chip}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 15l4-4 3 3 6-6" />
              </svg>
              Revenue Intelligence
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
