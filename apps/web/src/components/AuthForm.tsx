"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, login, register } from "@/lib/api";
import { PHONE_LAYOUT } from "@/lib/a11y";

type Mode = "login" | "register";

type AuthFormProps = {
  mode: Mode;
  nextPath?: string;
};

function safeNext(nextPath: string | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }
  return nextPath;
}

export function AuthForm({ mode, nextPath }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      router.replace(safeNext(nextPath));
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Something went wrong. Try again.";
      setError(message);
      setPending(false);
    }
  }

  const title = mode === "login" ? "Log in" : "Create account";
  const submitLabel = mode === "login" ? "Log in" : "Register";
  const altHref = mode === "login" ? "/register" : "/login";
  const altLabel =
    mode === "login" ? "Need an account? Register" : "Already have an account? Log in";

  return (
    <div className={`mx-auto w-full max-w-md ${PHONE_LAYOUT.minWidth} rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8`}>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700">Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
          {mode === "register" ? (
            <span className="text-xs text-zinc-500">At least 8 characters.</span>
          ) : null}
        </label>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? "Please wait…" : submitLabel}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600">
        <Link href={altHref} className="underline hover:text-zinc-900">
          {altLabel}
        </Link>
      </p>
    </div>
  );
}
