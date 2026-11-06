import type { ReactNode } from "react";

/** An external explorer link that opens in a new tab, with the ↗ marker. */
export function ExtLink({
  href,
  children,
  className = "",
  title,
  arrow = true,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Append " ↗" (turn off when the text already contains the arrow). */
  arrow?: boolean;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? href}
      className={`whitespace-nowrap border-b border-current/50 transition-opacity hover:opacity-60 ${className}`}
    >
      {children}
      {arrow && <span aria-hidden> ↗</span>}
    </a>
  );
}

/** "Payment ↗ HashScan" */
export function PaymentLink({ href, className = "text-[11px]" }: { href: string | null | undefined; className?: string }) {
  return (
    <ExtLink href={href} arrow={false} className={className}>
      Payment ↗ HashScan
    </ExtLink>
  );
}

/** "Ledger ↗" */
export function LedgerLink({ href, className = "text-[11px]" }: { href: string | null | undefined; className?: string }) {
  return (
    <ExtLink href={href} className={className}>
      Ledger
    </ExtLink>
  );
}

/** Numbered small links, e.g. "1 ↗ 2 ↗ 3 ↗", for a list of transaction URLs. */
export function TxLinkList({ urls, label, max = 30 }: { urls: string[]; label: string; max?: number }) {
  if (urls.length === 0) return null;
  const shown = urls.slice(-max);
  const offset = urls.length - shown.length;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="eyebrow opacity-70">{label}</span>
      {shown.map((url, i) => (
        <ExtLink key={url} href={url} className="text-[11px]">
          {offset + i + 1}
        </ExtLink>
      ))}
    </div>
  );
}
