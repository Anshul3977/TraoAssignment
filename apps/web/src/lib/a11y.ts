/**
 * Keyboard, dialog-focus, and 375px layout helpers (T27 / SPEC §12).
 * Pure so the walkthrough checklist can be unit-tested without a browser.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Smallest viewport we smoke-test (iPhone SE / SPEC phone). */
export const PHONE_MIN_WIDTH_PX = 375;

/**
 * Shared Tailwind tokens used at 375px so gutters stay inside the viewport
 * and wide tables scroll instead of overflowing the page.
 */
export const PHONE_LAYOUT = {
  skipHref: "#main",
  shellHeader: "px-4 py-3 sm:px-6 sm:py-4",
  shellMain: "px-4 py-6 sm:px-6 sm:py-10",
  section: "p-4 sm:p-6",
  overflowX: "overflow-x-auto",
  minWidth: "min-w-0",
  authPad: "px-4 py-12",
} as const;

export type KeyboardFlow = {
  id: string;
  title: string;
  keys: readonly string[];
};

/**
 * Keyboard-only walkthrough of every shipped flow (Verify: checklist).
 * Keys are the ones the UI must honour; Tab/Enter are implied for all forms.
 */
export const KEYBOARD_CHECKLIST: readonly KeyboardFlow[] = [
  { id: "auth", title: "Login / register / logout", keys: ["Tab", "Enter"] },
  { id: "dashboard", title: "Dashboard create / batch CTAs", keys: ["Tab", "Enter"] },
  {
    id: "create-kit",
    title: "Create kit form",
    keys: ["Tab", "Enter"],
  },
  { id: "batch", title: "Batch upload", keys: ["Tab", "Enter"] },
  { id: "job-progress", title: "Job progress + retry", keys: ["Tab", "Enter"] },
  { id: "builder-edit", title: "Inline edit + save status", keys: ["Tab"] },
  {
    id: "questions-tabs",
    title: "Question category tabs",
    keys: ["ArrowLeft", "ArrowRight", "Home", "End"],
  },
  {
    id: "questions-dnd",
    title: "Reorder questions (dnd-kit KeyboardSensor)",
    keys: ["Space", "ArrowUp", "ArrowDown"],
  },
  {
    id: "dialogs",
    title: "Confirm / conflict dialogs",
    keys: ["Tab", "Escape", "Enter"],
  },
  {
    id: "practice",
    title: "Practice session",
    keys: ["Space", "Enter", "1", "2", "3", "4", "5"],
  },
  {
    id: "schedule-coverage",
    title: "Schedule + coverage hash links",
    keys: ["Tab", "Enter"],
  },
  { id: "story-bank", title: "Story Bank", keys: ["Tab", "Enter"] },
];

export type TabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function isTabKey(key: string): key is TabKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "Home" ||
    key === "End"
  );
}

/** Wrap Tab inside a modal: last → first, first+Shift → last. */
export function nextFocusIndex(
  count: number,
  current: number,
  shiftKey: boolean,
): number {
  if (count <= 0) return -1;
  if (current < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  return current >= count - 1 ? 0 : current + 1;
}

/** ARIA tabs: arrows wrap; Home/End jump. */
export function nextCategoryIndex(
  count: number,
  current: number,
  key: TabKey,
): number {
  if (count <= 0) return -1;
  const i = Math.min(Math.max(0, current), count - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft") return i <= 0 ? count - 1 : i - 1;
  return i >= count - 1 ? 0 : i + 1;
}

export function queryFocusable(
  root: { querySelectorAll: (sel: string) => ArrayLike<Element> },
): Element[] {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
}

export function phoneLayoutFits(viewportWidthPx: number): boolean {
  return Number.isFinite(viewportWidthPx) && viewportWidthPx >= PHONE_MIN_WIDTH_PX;
}

export function keyboardFlowIds(): string[] {
  return KEYBOARD_CHECKLIST.map((f) => f.id);
}
