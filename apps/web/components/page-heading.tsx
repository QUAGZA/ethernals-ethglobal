import type { ReactNode } from "react";

/** The editorial page header used by every inner page: eyebrow, oversized serif title, optional intro. */
export function PageHeading({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="border-b px-[2.2vw] pt-[4.5vw] pb-[3vw] max-md:px-5 max-md:pt-12 max-md:pb-8">
      <p className="eyebrow m-0">{eyebrow}</p>
      <div className="mt-[3vw] flex items-end justify-between gap-10 max-md:mt-8 max-md:block">
        <h1 className="display-heading m-0 text-[clamp(56px,8vw,124px)] break-words max-md:text-[56px]">{title}</h1>
        {aside && <div className="shrink-0 max-md:mt-8">{aside}</div>}
      </div>
      {children && <div className="mt-[2.5vw] max-w-[640px] text-[14px] leading-[1.6] max-md:mt-6">{children}</div>}
    </section>
  );
}

/** A bordered panel with a mono header strip. */
export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`border ${className}`}>
      <header className="eyebrow flex items-center justify-between gap-4 border-b px-5 py-3.5">
        <span className="font-medium">{title}</span>
        {right && <span className="text-right normal-case tracking-normal">{right}</span>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A label/value pair for stat grids. */
export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="eyebrow opacity-60">{label}</div>
      <div className="mt-1 text-[15px] font-medium break-words">{value}</div>
    </div>
  );
}
