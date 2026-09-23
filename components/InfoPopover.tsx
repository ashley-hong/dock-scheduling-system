"use client";

import type { ReactNode } from "react";

/** A tiny, no-JS "pop down" explainer (an HTML <details>/<summary>) used
 * next to a control whose rule isn't obvious from the label alone. */
export default function InfoPopover({
  label = "Rules",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-[#7c3aed] hover:text-[#6d28d9] [&::-webkit-details-marker]:hidden">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none">
          i
        </span>
        {label}
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-72 rounded-md border border-[#e5e5e5] bg-white p-3 text-[12px] leading-relaxed text-[#6b7280] shadow-lg">
        {children}
      </div>
    </details>
  );
}
