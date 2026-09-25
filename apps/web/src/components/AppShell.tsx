import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "./LogoutButton";

type AppShellProps = {
  email: string;
  children: ReactNode;
};

export function AppShell({ email, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Prep Kit
            </Link>
            <nav className="text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">
                Dashboard
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-zinc-600 sm:inline">{email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
