import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The DealFlow360 logo lockup: the icon tile and the wordmark beside it.
 *
 * One component because the same markup was written out five times — the
 * sidebar, two portal screens, the quotation portal and diagnostics — and had
 * drifted in every copy. Each declared its own `width`/`height` for the same
 * two files, and all four wordmark copies declared a ratio the file does not
 * have: logo.png is 872x121 (7.21:1) and they claimed 5.36, 5.56, 5.33 and
 * 5.00. Next reserves layout from those numbers while the browser lays the
 * image out at its real ratio, so the box never matched the picture in it.
 *
 * INTRINSIC below are the files' actual pixel dimensions. Both marks are pure
 * greyscale — checked, zero saturated pixels — which is what makes the `invert`
 * trick sound: it flips black artwork to white for dark mode without touching
 * hue. A coloured logo could not be handled this way.
 */

const INTRINSIC = {
  icon: { width: 516, height: 514 },
  wordmark: { width: 872, height: 121 },
} as const;

/**
 * Sizes are named for where they are used rather than in pixels, so a screen
 * asks for the lockup it needs instead of re-deriving the numbers.
 *
 * `tile` is the padded square; `glyph` is the icon inside it, always small
 * enough to sit inside that padding — the sidebar previously put a 22px image
 * in a 20px content box, which is what made it look slightly wrong.
 *
 * `sizes` is the display width, not the file width, and it matters: the intrinsic
 * `width` tells Next the aspect ratio, but on its own it also makes Next pick a
 * srcset candidate for an 872px-wide image — it was fetching the 1920px variant
 * to paint a 173px logo. Naming the real width brings it down to the smallest
 * candidate that still covers a 2x screen.
 */
const SIZES = {
  sm: {
    tile: "size-6 rounded-md p-1",
    glyph: "size-4",
    glyphSizes: "16px",
    wordmark: "h-4.5",
    wordmarkSizes: "130px",
  },
  // Sized from the upstream "enhance brand logo sizing and visual balance"
  // commit, which deliberately made the mark bigger. That intent is kept here
  // rather than in five hand-written copies, so it now comes with the right
  // aspect ratio instead of the 180x32 (5.63:1) that commit declared.
  md: {
    tile: "size-9 rounded-xl p-2 shadow-sm",
    glyph: "size-5",
    glyphSizes: "20px",
    wordmark: "h-7",
    wordmarkSizes: "202px",
  },
  lg: {
    tile: "size-14 rounded-2xl p-2.5 shadow-md",
    glyph: "size-9",
    glyphSizes: "36px",
    wordmark: "h-8",
    wordmarkSizes: "231px",
  },
} as const;

export type BrandSize = keyof typeof SIZES;

export function BrandMark({
  size = "md",
  tile = true,
  wordmark = true,
  wordmarkClassName,
  orientation = "row",
  className,
  priority,
}: {
  size?: BrandSize;
  /** The dark rounded square behind the glyph. Off for a plain inline lockup. */
  tile?: boolean;
  /** Icon only, for somewhere too narrow for the wordmark. */
  wordmark?: boolean;
  /**
   * Classes on the wordmark alone, so a caller can hide it at a breakpoint
   * rather than at render time — the collapsing sidebar needs the wordmark to
   * come and go with CSS, not with a state change that React has to hydrate.
   */
  wordmarkClassName?: string;
  /** Stacked for the centred portal splashes, in a row everywhere else. */
  orientation?: "row" | "column";
  className?: string;
  priority?: boolean;
}) {
  const s = SIZES[size];

  const glyph = (
    <Image
      src="/icon.png"
      alt=""
      width={INTRINSIC.icon.width}
      height={INTRINSIC.icon.height}
      sizes={s.glyphSizes}
      // On the tile the glyph is inverted to sit on a dark ground and
      // un-inverted in dark mode, where the tile itself goes light. Without the
      // tile it follows the page instead, like any other text.
      className={cn(
        s.glyph,
        "object-contain",
        tile ? "invert dark:invert-0" : "dark:invert",
      )}
      priority={priority}
    />
  );

  return (
    <span
      className={cn(
        "flex min-w-0 items-center",
        orientation === "column" ? "flex-col gap-2" : "gap-2.5",
        className,
      )}
    >
      {tile ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center bg-zinc-950 dark:bg-zinc-100",
            s.tile,
          )}
        >
          {glyph}
        </span>
      ) : (
        glyph
      )}

      {wordmark ? (
        <Image
          src="/logo.png"
          alt="DealFlow360"
          width={INTRINSIC.wordmark.width}
          height={INTRINSIC.wordmark.height}
          sizes={s.wordmarkSizes}
          className={cn(s.wordmark, "w-auto object-contain dark:invert", wordmarkClassName)}
          priority={priority}
        />
      ) : null}
    </span>
  );
}
