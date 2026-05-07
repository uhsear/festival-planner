/**
 * Skeleton for /account — avatar, username field, password section, and
 * push-notifications block. Matches the stacked card layout of AccountPage.
 */
export default function AccountSkeleton() {
  return (
    <div
      className="space-y-4 px-4 pb-24"
      aria-busy="true"
      aria-label="Loading account"
    >
      {/* avatar row */}
      <div className="flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="skeleton h-16 w-16 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="skeleton h-3.5 w-1/2" />
          <div className="skeleton h-8 w-[120px] rounded-md" />
        </div>
      </div>

      {/* form cards */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
        >
          <div className="skeleton h-4 w-2/5" />
          <div className="skeleton h-10 w-full rounded-md" />
          {i !== 2 && (
            <div className="skeleton h-10 w-full rounded-md" />
          )}
          <div className="skeleton mt-1 h-9 w-[120px] rounded-md" />
        </div>
      ))}
    </div>
  );
}
