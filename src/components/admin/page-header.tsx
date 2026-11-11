export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1.5">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card/60 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="bg-brand-soft text-brand-strong flex size-10 items-center justify-center rounded-full"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9z" />
        </svg>
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-card rounded-xl border p-4 shadow-xs ${className ?? ""}`}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-2 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="text-muted-foreground mt-2 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
