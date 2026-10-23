export function Metric({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
      <div className="text-sm font-medium tabular-nums">
        {value}
        {suffix}
      </div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}

/** Keep only the host and tail of long URLs so agents can identify the source. */
export function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    const text = `${url.host}${path}${url.search}`;
    return text.length > 46 ? `${text.slice(0, 44)}?` : text;
  } catch {
    return value.length > 46 ? `${value.slice(0, 44)}?` : value;
  }
}

export function InfoRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate underline underline-offset-2"
          title={value}
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate" title={value}>
          {value}
        </span>
      )}
    </div>
  );
}
