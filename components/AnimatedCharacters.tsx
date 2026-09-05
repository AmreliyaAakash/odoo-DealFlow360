"use client";

import React, { useEffect, useState, useRef } from "react";

interface AnimatedCharactersProps {
  formState?: "idle" | "email" | "password" | "passwordVisible" | "submitting";
}

export default function AnimatedCharacters({ formState = "idle" }: AnimatedCharactersProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pupilPos, setPupilPos] = useState({ x: 0, y: 0 });
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;

      const dist = Math.hypot(deltaX, deltaY);
      const maxRadius = 9;
      const angle = Math.atan2(deltaY, deltaX);
      const clampedDist = Math.min(dist / 18, maxRadius);

      const px = Math.cos(angle) * clampedDist;
      const py = Math.sin(angle) * clampedDist;

      setPupilPos({ x: px, y: py });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const isEmail = formState === "email";
  const isPassword = formState === "password";

  // Dynamic animation transforms
  let purpleTransform = "translate(0, 0) rotate(0deg)";
  let purpleEyeY = 0;
  if (isEmail) {
    purpleTransform = "translate(6px, -14px) rotate(5deg)";
    purpleEyeY = -4;
  } else if (isPassword) {
    purpleTransform = "translate(-10px, 12px) rotate(-14deg)";
    purpleEyeY = 5;
  }

  let orangeTransform = "translate(0, 0)";
  if (isPassword) {
    orangeTransform = "translate(-6px, 6px)";
  } else if (isEmail) {
    orangeTransform = "translate(3px, -3px)";
  }

  let yellowTransform = "translate(0, 0)";
  if (isEmail) {
    yellowTransform = "translate(4px, -6px)";
  } else if (isPassword) {
    yellowTransform = "translate(8px, 8px)";
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-gradient-to-b from-[#f5f5f7] to-[#eef0f5] flex items-end justify-center p-6 select-none overflow-hidden"
    >
      {/* Background Subtle Radial Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8)_0%,transparent_70%)] pointer-events-none" />

      <svg
        viewBox="0 0 400 380"
        className={`w-full h-auto max-w-[340px] drop-shadow-md transition-all duration-700 ${
          isLoaded ? "translate-y-0 opacity-100 scale-100" : "translate-y-12 opacity-0 scale-95"
        }`}
      >
        <defs>
          {/* Vibrant Gradients */}
          <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>

          <linearGradient id="orangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff7849" />
            <stop offset="100%" stopColor="#f95722" />
          </linearGradient>

          <linearGradient id="yellowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffea00" />
            <stop offset="100%" stopColor="#eab308" />
          </linearGradient>

          <linearGradient id="blackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#09090b" />
          </linearGradient>
        </defs>

        {/* BACK CHARACTER: Dark Indigo/Black Pillar */}
        <g
          className="transition-transform duration-500 ease-out"
          style={{ transform: isPassword ? "translate(6px, 10px)" : "translate(0, 0)" }}
        >
          <rect
            x="172"
            y="120"
            width="68"
            height="225"
            rx="14"
            fill="url(#blackGrad)"
          />
          {/* Eyes */}
          <g transform={`translate(${pupilPos.x * 0.7}, ${pupilPos.y * 0.7 + (isPassword ? 6 : 0)})`}>
            <circle cx="194" cy="165" r="5.5" fill="#ffffff" />
            <circle cx="194" cy="165" r="2.8" fill="#000000" />
            <circle cx="218" cy="165" r="5.5" fill="#ffffff" />
            <circle cx="218" cy="165" r="2.8" fill="#000000" />
          </g>
        </g>

        {/* TALL CHARACTER: Vibrant Purple Pillar */}
        <g
          className="transition-all duration-500 ease-out origin-bottom"
          style={{ transform: purpleTransform }}
        >
          <rect
            x="110"
            y="65"
            width="90"
            height="280"
            rx="18"
            fill="url(#purpleGrad)"
          />

          {/* Purple Eyes */}
          {!isPassword ? (
            <g transform={`translate(${pupilPos.x}, ${pupilPos.y + purpleEyeY})`}>
              <circle cx="142" cy="110" r="7.5" fill="#ffffff" />
              <circle cx="142" cy="110" r="3.8" fill="#000000" />
              <circle cx="170" cy="110" r="7.5" fill="#ffffff" />
              <circle cx="170" cy="110" r="3.8" fill="#000000" />
            </g>
          ) : (
            /* Closed shy eyes when typing password */
            <g transform="translate(0, 110)">
              <path
                d="M 136 -2 Q 142 5 148 -2"
                stroke="#ffffff"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 164 -2 Q 170 5 176 -2"
                stroke="#ffffff"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          )}

          {/* Purple Nose/Mouth */}
          <line
            x1="150"
            y1="130"
            x2="164"
            y2="130"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>

        {/* RIGHT CHARACTER: Sunny Yellow Arch Pillar */}
        <g
          className="transition-transform duration-500 ease-out"
          style={{ transform: yellowTransform }}
        >
          <rect
            x="240"
            y="170"
            width="78"
            height="175"
            rx="38"
            fill="url(#yellowGrad)"
          />
          {/* Eyes */}
          <g transform={`translate(${pupilPos.x * 0.8}, ${pupilPos.y * 0.8})`}>
            <circle cx="266" cy="215" r="4.8" fill="#18181b" />
            <circle cx="290" cy="215" r="4.8" fill="#18181b" />
          </g>
          {/* Beak */}
          <path
            d="M 273 224 L 283 224 L 278 231 Z"
            fill="#d97706"
          />
        </g>

        {/* FRONT CHARACTER: Vibrant Orange Dome */}
        <g
          className="transition-transform duration-500 ease-out"
          style={{ transform: orangeTransform }}
        >
          <path
            d="M 45 345 A 95 95 0 0 1 235 345 Z"
            fill="url(#orangeGrad)"
          />
          {/* Eyes */}
          <g transform={`translate(${pupilPos.x * 0.9}, ${pupilPos.y * 0.9})`}>
            <circle cx="115" cy="288" r="5.5" fill="#18181b" />
            <circle cx="165" cy="288" r="5.5" fill="#18181b" />
          </g>
          {/* Smile */}
          <path
            d={isPassword ? "M 132 308 Q 140 300 148 308" : "M 132 302 Q 140 314 148 302"}
            stroke="#18181b"
            strokeWidth="3.8"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      </svg>
    </div>
  );
}
