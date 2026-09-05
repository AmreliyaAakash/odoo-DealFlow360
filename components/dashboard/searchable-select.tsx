"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  /** Optional heading this option is filed under; blank groups render flat. */
  group?: string;
  /** Secondary text shown under the label — a SKU, a price. */
  hint?: string;
  /** Rendered to the right of the label. Used for the customer tier badge. */
  badge?: React.ReactNode;
  /** Extra text the filter should match even though it is not displayed. */
  keywords?: string;
};

/** Room needed below the trigger before the list is allowed to open downwards. */
const MIN_DROP_SPACE = 220;

type Placement = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

/**
 * A combobox: a button that opens a filterable list.
 *
 * The list is rendered in a portal on `document.body`, not beside the button.
 * It has to be: the dashboard's panels and rows all carry `.df-rise-in`, which
 * animates `transform` and so makes each one its own stacking context — a
 * popover left in the tree is painted over by the next panel down the page no
 * matter how high its z-index is, and clipped by any scrolling ancestor. A
 * portal plus fixed positioning sidesteps both.
 */
export function SearchableSelect({
  value,
  options,
  placeholder = "Select…",
  emptyText = "Nothing matches",
  invalid = false,
  disabled = false,
  label,
  className,
  onChange,
}: {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Accessible name, since the visible label sits outside this control. */
  label: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;

    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""} ${option.group ?? ""} ${option.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [options, query]);

  // Grouped for display, but `matches` stays the flat list the keyboard walks —
  // one index into one array, so roving cannot drift out of sync with the render.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SelectOption[]>();
    for (const option of matches) {
      const key = option.group ?? "";
      const existing = byGroup.get(key);
      if (existing) existing.push(option);
      else byGroup.set(key, [option]);
    }
    return [...byGroup.entries()];
  }, [matches]);

  // Clamped at the point of use rather than reset by an effect: filtering down
  // to fewer results must not leave the highlight pointing past the end.
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;

    // Open upwards only when there genuinely is not room below and there is
    // more room above — near the foot of the page, which is where the last line
    // of a long quotation always sits.
    const up = below < MIN_DROP_SPACE && above > below;

    setPlacement({
      top: up ? undefined : rect.bottom + 4,
      bottom: up ? window.innerHeight - rect.top + 4 : undefined,
      left: rect.left,
      width: Math.max(rect.width, 224),
      maxHeight: Math.max((up ? above : below) - 4, 140),
    });
  }, []);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Measured here, in the event, so the list is positioned on its first paint
    // rather than flashing at the top-left corner and then jumping.
    place();
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    // Capture, because the trigger may sit inside a scrollable panel that does
    // not bubble its scroll to the window.
    const reposition = () => place();

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const from = Math.min(current, Math.max(matches.length - 1, 0));
        return (from + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = matches[activeIndex];
      if (option) choose(option);
    }
  }

  const popup =
    open && placement ? (
      <div
        ref={popupRef}
        style={{
          position: "fixed",
          top: placement.top,
          bottom: placement.bottom,
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
        }}
        className="z-[100] flex flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10"
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
          <MagnifyingGlassIcon size={12} className="shrink-0 text-muted-foreground" />
          <input
            // Mounts only while open, so this focuses the search on each open.
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            aria-label={`Search ${label}`}
            aria-controls={listId}
            className="h-8 w-full bg-transparent text-xs outline-none"
          />
        </div>

        <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
          {groups.map(([group, items]) => (
            <li key={group}>
              {group ? (
                <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group}
                </p>
              ) : null}
              <ul>
                {items.map((option) => {
                  const index = matches.indexOf(option);
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(option)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          index === activeIndex && "bg-muted",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {option.label}
                          </span>
                          {option.hint ? (
                            <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                              {option.hint}
                            </span>
                          ) : null}
                        </span>
                        {option.badge}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}

          {matches.length === 0 ? (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              {emptyText}
            </li>
          ) : null}
        </ul>
      </div>
    ) : null;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          "flex h-8 w-full items-center gap-1.5 rounded-lg bg-muted/60 px-2 text-left text-xs outline-none ring-1 transition",
          "focus-visible:bg-background focus-visible:ring-indigo-500 disabled:opacity-50",
          invalid ? "ring-red-500/70" : "ring-transparent",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            selected.label
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        {selected?.badge}
        <CaretDownIcon size={11} className="shrink-0 text-muted-foreground" />
      </button>

      {popup ? createPortal(popup, document.body) : null}
    </div>
  );
}
