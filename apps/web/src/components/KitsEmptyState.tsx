import Link from "next/link";

/**
 * Dashboard kit list.
 * docs/API.md has no kit list route yet — empty state only.
 * Create CTA → /kits/new (T22a → POST /kits). Do not invent list endpoints.
 */
export function KitsEmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-8 py-16 text-center">
      <h2 className="text-xl font-semibold tracking-tight">No kits yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
        Create a prep kit from a job description and company URL. Your kits will
        appear here.
      </p>
      <Link
        href="/kits/new"
        className="mt-6 inline-flex rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Create a kit
      </Link>
    </section>
  );
}
