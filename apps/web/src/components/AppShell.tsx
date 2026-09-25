import Link from "next/link";
import type { ReactNode } from "react";
import { PHONE_LAYOUT } from "@/lib/a11y";
import { LogoutButton } from "./LogoutButton";

type AppShellProps = {
  email: string;
  children: ReactNode;
};

export function AppShell({ email, children }: AppShellProps) {
  return (
    <div className={`min-h-screen ${PHONE_LAYOUT.minWidth} bg-zinc-50 text-zinc-900`}>
      <header className="border-b border-zinc-200 bg-white">
        <div
          className={`mx-auto flex max-w-5xl items-center justify-between gap-3 ${PHONE_LAYOUT.shellHeader}`}
        >
          <div className="flex min-w-0 items-baseline gap-4 sm:gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Prep Kit
            </Link>
            <nav className="text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">
                Dashboard
              </Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <span className="hidden text-sm text-zinc-600 sm:inline">{email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main
        id="main"
        className={`mx-auto max-w-5xl ${PHONE_LAYOUT.minWidth} ${PHONE_LAYOUT.shellMain}`}
      >
        {children}
      </main>
    </div>
  );
}
