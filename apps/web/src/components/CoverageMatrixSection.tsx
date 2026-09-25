"use client";

import { useId, useMemo } from "react";
import type { KitQuestion } from "@/lib/api";
import { buildCoverageMatrix } from "@/lib/schedule-views";

type CoverageMatrixSectionProps = {
  requirements: readonly {
    id: string;
    text: string;
    priority: string;
  }[];
  questions: readonly KitQuestion[];
  uncoveredRequirementIds: readonly string[];
};

/**
 * Requirements × questions coverage matrix (§8 visibility).
 * Gap rows highlight `coverage.uncovered_requirement_ids` from the kit.
 */
export function CoverageMatrixSection({
  requirements,
  questions,
  uncoveredRequirementIds,
}: CoverageMatrixSectionProps) {
  const titleId = useId();
  const matrix = useMemo(
    () =>
      buildCoverageMatrix(requirements, questions, uncoveredRequirementIds),
    [requirements, questions, uncoveredRequirementIds],
  );
  const gapCount = matrix.rows.filter((r) => r.gap).length;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-zinc-200 bg-white p-6"
      data-testid="coverage-matrix"
    >
      <h2 id={titleId} className="text-lg font-semibold tracking-tight">
        Coverage matrix
      </h2>
      <p className="mt-1 text-sm text-zinc-600" data-testid="coverage-matrix-summary">
        Requirements × questions. Gaps from{" "}
        <code className="text-xs">uncovered_requirement_ids</code>
        {gapCount > 0 ? (
          <>
            {" "}
            —{" "}
            <span className="font-medium text-amber-800">
              {gapCount} gap{gapCount === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <> — no gaps</>
        )}
        .
      </p>

      {requirements.length === 0 || questions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          Need requirements and questions to show the matrix.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200">
                <th
                  scope="col"
                  className="sticky left-0 bg-white px-2 py-2 font-medium text-zinc-700"
                >
                  Requirement
                </th>
                {matrix.questionIds.map((qid) => (
                  <th
                    key={qid}
                    scope="col"
                    className="px-2 py-2 text-center font-mono font-medium text-zinc-600"
                  >
                    <a
                      href={`#question-${qid}`}
                      className="underline hover:text-zinc-900"
                    >
                      {qid}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr
                  key={row.requirementId}
                  className={
                    row.gap
                      ? "bg-amber-50"
                      : "bg-white even:bg-zinc-50/60"
                  }
                  data-testid={`matrix-row-${row.requirementId}`}
                  data-gap={row.gap ? "true" : "false"}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 px-2 py-2 font-normal ${
                      row.gap ? "bg-amber-50" : "bg-inherit"
                    }`}
                  >
                    <span className="font-mono text-zinc-500">
                      {row.requirementId}
                    </span>
                    <span className="ml-2 uppercase tracking-wide text-zinc-400">
                      {row.priority}
                    </span>
                    {row.gap ? (
                      <span
                        className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                        data-testid={`matrix-gap-${row.requirementId}`}
                      >
                        Gap
                      </span>
                    ) : null}
                    <p className="mt-0.5 max-w-xs text-zinc-800">{row.text}</p>
                  </th>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.questionId}
                      className="px-2 py-2 text-center"
                      data-testid={`matrix-cell-${cell.requirementId}-${cell.questionId}`}
                      data-linked={cell.linked ? "true" : "false"}
                    >
                      {cell.linked ? (
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
                          title="Linked"
                          aria-label="Linked"
                        />
                      ) : (
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-200"
                          title="Not linked"
                          aria-label="Not linked"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
