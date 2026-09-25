"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, logout } from "@/lib/api";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogout() {
    setPending(true);
    setError(null);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not sign out. Try again.";
      setError(message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onLogout}
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Log out"}
      </button>
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
