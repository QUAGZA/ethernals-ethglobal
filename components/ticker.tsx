const items = [
  "ENS IDENTITY",
  "WORLD ID VERIFIED",
  "PRIVATE EXECUTION",
  "X402 PAYMENTS",
  "ON-CHAIN REPUTATION",
];

export function Ticker() {
  return (
    <section
      className="overflow-hidden border-b bg-ink py-[13px] whitespace-nowrap text-paper"
      aria-label="Platform capabilities"
    >
      <div className="inline-block animate-marquee">
        {items.map((item) => (
          <span key={item}>
            {item} <span className="mx-[30px] text-yellow">✳</span>{" "}
          </span>
        ))}
      </div>
    </section>
  );
}
