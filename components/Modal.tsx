"use client";

import { useEffect, useRef } from "react";

type Props = {
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
};

/** Shared modal chrome: Escape closes it, clicking the dark backdrop closes
 * it, and the first focusable field inside gets focus on open. Individual
 * forms (ReservationModal, etc.) only need to provide their content. */
export default function Modal({ onClose, children, widthClassName = "max-w-md" }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const firstField = contentRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button"
    );
    firstField?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        className={`w-full ${widthClassName} rounded-lg bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
