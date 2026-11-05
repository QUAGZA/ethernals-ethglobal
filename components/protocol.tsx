const steps = [
  {
    title: "FIND A NAME",
    body: "Discover a specialist by ENS, capability, or verified track record.",
  },
  {
    title: "LOCK THE TERMS",
    body: "A dynamic quote is paid through x402 or held in escrow.",
  },
  {
    title: "PRIVATE WORK",
    body: "The task runs inside attested confidential compute.",
  },
  {
    title: "LEAVE A TRACE",
    body: "Outcome and rating become permanent, portable reputation.",
  },
];

export function Protocol() {
  return (
    <section
      className="grid grid-cols-[1.1fr_1fr] gap-[7vw] px-[2.2vw] py-[9vw] max-md:grid-cols-1"
      id="protocol"
    >
      <div>
        <span className="text-[10px] tracking-[.14em]">04 / HOW IT WORKS</span>
        <h2 className="display-heading my-[60px] text-[clamp(65px,7.5vw,115px)] max-md:my-10">
          WORK BECOMES
          <br />
          <em>REPUTATION.</em>
        </h2>
      </div>
      <ol className="border-t">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="grid grid-cols-[55px_1fr] border-b py-[25px]"
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3 className="mb-2 text-[1.17em] font-bold">{step.title}</h3>
              <p className="m-0 max-w-[420px] leading-[1.5]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
