"use client";

import React, { useState, useEffect, useRef } from "react";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import AnimatedCharacters from "@/components/AnimatedCharacters";

export default function SignUpPage() {
  const [formState, setFormState] = useState<"idle" | "email" | "password" | "passwordVisible" | "submitting">("idle");
  const formWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = formWrapperRef.current;
    if (!wrapper) return;

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLInputElement | null;
      if (!target) return;

      const name = (target.name || target.id || target.type || "").toLowerCase();
      const placeholder = (target.placeholder || "").toLowerCase();

      if (
        name.includes("email") ||
        name.includes("identifier") ||
        name.includes("username") ||
        placeholder.includes("email") ||
        target.type === "email"
      ) {
        setFormState("email");
      } else if (
        name.includes("password") ||
        placeholder.includes("password") ||
        target.type === "password"
      ) {
        setFormState("password");
      } else {
        setFormState("email");
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) {
          setFormState("idle");
        }
      }, 100);
    };

    wrapper.addEventListener("focusin", handleFocusIn);
    wrapper.addEventListener("focusout", handleFocusOut);

    return () => {
      wrapper.removeEventListener("focusin", handleFocusIn);
      wrapper.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return (
    <main className="min-h-screen w-full flex flex-col lg:flex-row font-sans selection:bg-slate-200">
      {/* LEFT 50% FULL SCREEN PANEL: Interactive Animated Characters */}
      <div className="w-full lg:w-1/2 h-64 lg:h-screen lg:sticky lg:top-0 bg-[#f4f4f6] relative flex items-end justify-center overflow-hidden">
        <AnimatedCharacters formState={formState} />
      </div>

      {/* RIGHT 50% FULL SCREEN PANEL: Clerk Auth Form & Header */}
      <div className="w-full lg:w-1/2 lg:min-h-screen bg-white text-slate-900 flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-sm mx-auto my-auto flex flex-col items-center">
          {/* Top Star Logo */}
          <div className="mb-4 sm:mb-6 flex items-center justify-center">
            <svg viewBox="0 0 36 36" className="w-9 h-9 sm:w-10 sm:h-10 text-slate-900 fill-current">
              <path d="M18 0 C18 10, 26 18, 36 18 C26 18, 18 26, 18 36 C18 26, 10 18, 0 18 C10 18, 18 10, 18 0 Z" />
            </svg>
          </div>

          {/* Title & Subtitle */}
          <div className="text-center space-y-1 mb-6">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Get started
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Create your DealFlow 360 account
            </p>
          </div>

          {/* Clerk Form Component */}
          <div ref={formWrapperRef} className="w-full">
            <SignUp
              appearance={{
                elements: {
                  rootBox: "w-full shadow-none",
                  cardBox: "w-full shadow-none bg-transparent p-0 border-0",
                  card: "w-full shadow-none bg-transparent p-0 border-0",
                  headerTitle: "hidden",
                  headerSubtitle: "hidden",
                  socialButtonsBlockButton: "w-full bg-slate-50 hover:bg-slate-100/80 border border-slate-200 text-slate-800 font-sans font-semibold py-2.5 rounded-xl transition-all duration-200 shadow-sm text-xs sm:text-sm flex items-center justify-center gap-2",
                  socialButtonsBlockButtonText: "text-slate-700 font-sans font-semibold text-xs sm:text-sm",
                  dividerLine: "bg-slate-200",
                  dividerText: "text-slate-400 font-sans text-[11px] uppercase tracking-wider bg-white px-2",
                  formButtonPrimary: "w-full bg-[#18181b] hover:bg-black text-white font-semibold font-sans py-3 rounded-xl shadow-md transition-all duration-200 text-xs sm:text-sm active:scale-[0.99] mt-2",
                  formFieldInput: "w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 rounded-xl font-sans text-slate-900 placeholder-slate-400 transition-all duration-200 text-xs sm:text-sm py-2.5 px-3.5 shadow-sm",
                  formFieldLabel: "font-sans font-medium text-slate-700 text-xs mb-1",
                  footerActionLink: "text-slate-900 hover:underline font-sans font-semibold text-xs transition-colors",
                  footerActionText: "text-slate-500 font-sans text-xs",
                  identityPreviewText: "font-sans text-slate-700 text-xs",
                  identityPreviewEditButton: "text-slate-900 hover:underline font-sans text-xs font-semibold",
                  formHeaderTitle: "hidden",
                  formHeaderSubtitle: "hidden",
                  alertText: "text-red-600 font-sans text-xs",
                  formResendCodeLink: "text-slate-900 hover:underline font-sans text-xs font-semibold",
                },
              }}
            />
          </div>

          {/*
            Smart CAPTCHA (Cloudflare Turnstile) needs a visible mount point.
            Without one Clerk cannot resolve the challenge, and the social
            buttons hang on their spinner instead of redirecting.
          */}
          <div id="clerk-captcha" className="mt-4 flex w-full justify-center" />
        </div>

        {/* Bottom link back home */}
        <div className="text-center text-xs text-slate-400 mt-2">
          <Link href="/" className="hover:text-slate-700 transition-colors">
            &larr; Return to DealFlow 360 Home
          </Link>
        </div>
      </div>
    </main>
  );
}
