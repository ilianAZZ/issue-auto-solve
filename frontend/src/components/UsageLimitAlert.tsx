export function UsageLimitAlert({ retryAt }: { retryAt: string | null }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-amber/30 bg-amber-soft px-4 py-2.5 text-center text-[13px] text-amber"
    >
      <span>
        Claude's usage limit was hit — runs are paused
        {retryAt ? ` and will retry automatically at ${new Date(retryAt).toLocaleString()}` : ''}.
      </span>
    </div>
  );
}
