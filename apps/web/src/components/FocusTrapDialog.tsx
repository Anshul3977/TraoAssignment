"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { nextFocusIndex, queryFocusable } from "@/lib/a11y";

type FocusTrapDialogProps = {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  testId: string;
  backdropTestId: string;
};

/**
 * Modal: traps Tab, Escape closes, restores focus to the opener.
 */
export function FocusTrapDialog({
  titleId,
  onClose,
  children,
  testId,
  backdropTestId,
}: FocusTrapDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const nodes = panel ? queryFocusable(panel) : [];
    const first = nodes[0] as HTMLElement | undefined;
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const list = queryFocusable(panel) as HTMLElement[];
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(list.length, current, e.shiftKey);
      e.preventDefault();
      list[next]?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      data-testid={backdropTestId}
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 shadow-lg"
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
