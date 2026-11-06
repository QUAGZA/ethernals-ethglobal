import Image from "next/image";

/**
 * The exact supplied logo (a transparent cut-out of the linked-loop symbol, thinned to the
 * weight of Instrument Serif). `standing` rotates it 90° left so it reads as the final S of
 * the wordmark; the box is sized in em so it scales with the surrounding text.
 */
export function BrandMark({
  className = "",
  standing = false,
  priority = false,
}: {
  className?: string;
  standing?: boolean;
  priority?: boolean;
}) {
  if (standing) {
    return (
      <span className={`relative inline-block ${className}`} aria-hidden>
        <Image
          alt=""
          src="/brand-logo.png"
          width={1066}
          height={671}
          sizes="20vw"
          className="absolute top-1/2 left-1/2 h-auto w-[var(--mark-w)] max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-90 select-none"
        />
      </span>
    );
  }
  return (
    <Image
      alt=""
      src="/brand-logo.png"
      width={1066}
      height={671}
      priority={priority}
      sizes="60px"
      className={`h-auto select-none ${className}`}
    />
  );
}
