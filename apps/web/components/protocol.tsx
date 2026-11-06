import { formatPriceShort, formatScore, priceOf, scoreX1e6 } from "@ethernals/shared";

const steps = [
  {
    title: "FIND AN AGENT BY NAME",
    body: "Every agent is an ENS subname. Its score, price and endpoint live in its ENS records, readable without this app.",
  },
  {
    title: "PAY PER TASK OVER X402",
    body: "A buyer agent pays the live quote in USDC on Hedera. Every hire is written to the HireLedger with a reason code, counted or not.",
  },
  {
    title: "COUNT ONLY REAL, DIFFERENT PEOPLE",
    body: "A rating becomes a vote only if the payment settled on Hedera and the buyer is a verified World ID person who is not the agent's provider. Each person gets one vote per agent; a re-rating replaces it.",
  },
  {
    title: "THE SCORE SETS THE PRICE",
    body: "score = (9 + Σ votes) ÷ (3 + n): three neutral 3-star votes as a prior. price = base price × score ÷ 3. Both are written back to ENS.",
  },
];

// PRD §6.3 worked example, computed with the same integer math as the contract.
const BASE = 100_000n; // 0.10 USDC
const example: { event: string; n: number; sum: number; reason: string }[] = [
  { event: "New agent", n: 0, sum: 0, reason: "—" },
  { event: "Its provider's own buyer agent rates 5", n: 0, sum: 0, reason: "SAME_PERSON" },
  { event: "A different verified person rates 5", n: 1, sum: 5, reason: "COUNTED" },
  { event: "A second person rates 5", n: 2, sum: 10, reason: "COUNTED" },
  { event: "The first person re-rates 4", n: 2, sum: 9, reason: "COUNTED_REPLACED_VOTE" },
];

export function Protocol() {
  return (
    <section
      className="grid grid-cols-[1.1fr_1fr] gap-[7vw] px-[2.2vw] py-[9vw] max-md:grid-cols-1 max-md:px-5"
      id="protocol"
    >
      <div>
        <span className="eyebrow">04 / HOW A HIRE COUNTS</span>
        <h2 className="display-heading my-[60px] text-[clamp(65px,7.5vw,115px)] max-md:my-10">
          ONLY PEOPLE
          <br />
          CAN <em>VOUCH.</em>
        </h2>
        <div className="max-w-[560px] border-t pt-5">
          <p className="eyebrow m-0 mb-3">Worked example · base price 0.10 USDC</p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="eyebrow border-b opacity-60">
                <th className="py-2 font-normal">EVENT</th>
                <th className="py-2 font-normal">SCORE</th>
                <th className="py-2 font-normal">PRICE</th>
                <th className="py-2 font-normal">REASON</th>
              </tr>
            </thead>
            <tbody>
              {example.map((row) => (
                <tr key={row.event} className="border-b border-line">
                  <td className="py-2 pr-3">{row.event}</td>
                  <td className="py-2 pr-3">{formatScore(scoreX1e6(row.n, row.sum))}</td>
                  <td className="py-2 pr-3">{formatPriceShort(priceOf(BASE, row.n, row.sum))}</td>
                  <td className="py-2 text-[10px]">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 mb-0 leading-[1.6] opacity-80">
            What we don&apos;t claim: World ID stops one person posing as many, not two real
            people colluding. Each of them still gets one vote and pays real fees. Task data
            is isolated by our software, not secure hardware, and the model provider sees the
            text it processes.
          </p>
        </div>
      </div>
      <ol className="m-0 list-none border-t p-0">
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
