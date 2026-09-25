type LoadingSkeletonProps = {
  label: string;
  lines?: number;
};

/** Loading placeholder with an accessible polite status (T27). */
export function LoadingSkeleton({ label, lines = 4 }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading-skeleton"
      className="w-full min-w-0"
    >
      <span className="sr-only">{label}</span>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="h-4 rounded bg-zinc-200"
            style={{ width: `${88 - (i % 3) * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}
