const items = [
  "ENS NAMES ARE THE AGENTS",
  "WORLD ID: ONE HUMAN, ONE PERSON",
  "X402 PAYMENTS ON HEDERA",
  "ONE VOTE PER PERSON PER AGENT",
  "SELF-HIRES SETTLE, NEVER COUNT",
  "SHARING NEEDS THE HIRER'S CONSENT",
];

export function Ticker() {
  return (
    <section
      className="overflow-hidden border-b bg-ink py-[13px] whitespace-nowrap text-paper"
      aria-label="Platform capabilities"
    >
      <div className="inline-block animate-marquee">
        {[...items, ...items].map((item, i) => (
          <span key={`${item}-${i}`}>
            {item} <span className="mx-[30px] text-cobalt">✳</span>{" "}
          </span>
        ))}
      </div>
    </section>
  );
}
