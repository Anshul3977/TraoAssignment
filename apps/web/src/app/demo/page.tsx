import type { Metadata } from "next";
import { DemoRunner } from "@/components/DemoRunner";

export const metadata: Metadata = {
  title: "Prep Kit demo — interview prep from a job description",
  description:
    "Paste a job description and a company URL. Prep Kit researches the company and builds grounded interview questions, flashcards and a day-by-day plan.",
};

export default function DemoPage() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Prep Kit · public demo</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          Turn a job description into an interview prep kit
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
          The pipeline crawls the company site (respecting robots.txt), extracts only requirements that are
          literally in the JD, generates questions until every must-have is covered, then schedules them across
          your days. No account needed and nothing is saved. Runs on a free LLM tier, so a kit takes about 2–3 minutes
          and the demo is limited to 3 kits per hour.
        </p>
        <p className="mt-2 text-sm">
          <a className="font-medium text-zinc-900 underline underline-offset-4" href="/login">
            Sign in
          </a>{" "}
          <span className="text-zinc-500">to save, edit and practice kits.</span>
        </p>
      </header>
      <DemoRunner />
    </main>
  );
}
