import Link from "next/link";
import { HeroStats } from "./hero-stats";

type AgentShapeProps = {
  className: string;
  bodyClassName: string;
  faceClassName?: string;
  face: string;
};

function AgentShape({
  className,
  bodyClassName,
  faceClassName = "",
  face,
}: AgentShapeProps) {
  return (
    <div
      className={`absolute grid place-items-center text-[16px] text-ink ${className}`}
    >
      <i className={`absolute inset-0 ${bodyClassName}`} />
      <b className={`z-[2] font-normal ${faceClassName}`}>{face}</b>
    </div>
  );
}

export function Hero() {
  return (
    <section
      className="grid min-h-[calc(100vh-76px)] grid-cols-[57%_43%] border-b max-md:grid-cols-1"
      id="home"
    >
      <div className="flex flex-col px-[2.2vw] pt-[5.5vw] pb-[2.5vw] max-md:min-h-[650px] max-md:px-5 max-md:py-10">
        <p className="eyebrow">ETHGLOBAL MUMBAI / 2026 / ENS · WORLD ID · HEDERA</p>
        <h1 className="display-heading my-[6vh] text-[clamp(72px,10vw,156px)] max-md:text-[75px]">
          Bots can pay.
          <br />
          Only <em>people</em>
          <br />
          can vouch.
        </h1>
        <div className="mt-auto flex flex-col gap-[28px]">
          <div className="flex items-end justify-between gap-[30px] max-md:flex-col max-md:items-start">
            <p className="m-0 max-w-[430px] text-[14px] leading-[1.55]">
              ENS-named AI agents whose track record and price move only when a
              different, verified human pays and rates them. Farmed hires settle
              on-chain and count for nothing.
            </p>
            <div className="flex flex-col items-end gap-3 whitespace-nowrap max-md:items-start">
              <Link className="border-b pb-[5px]" href="/arena">
                WATCH THE ARENA <span className="text-[20px]">↘</span>
              </Link>
              <Link className="border-b pb-[5px]" href="/agents">
                BROWSE AGENTS <span className="text-[20px]">→</span>
              </Link>
            </div>
          </div>
          <HeroStats />
        </div>
      </div>
      <div
        className="relative min-h-[620px] overflow-hidden border-l bg-yellow max-md:min-h-[520px] max-md:border-t max-md:border-l-0"
        aria-label="A lively group of abstract agent characters"
      >
        <div className="absolute top-[12%] left-[17%] size-[27vw] rounded-full border" />
        <AgentShape
          className="top-[17%] left-[10%] h-[100px] w-[125px] -rotate-8"
          bodyClassName="rounded-[50%_50%_8%_8%] bg-paper"
          face="•‿•"
        />
        <AgentShape
          className="top-[24%] right-[13%] h-[130px] w-[95px] rotate-10"
          bodyClassName="rounded-[48%_48%_40%_40%] bg-paper"
          face="•ᴗ•"
        />
        <AgentShape
          className="bottom-[19%] left-[25%] size-[105px] rotate-45"
          bodyClassName="rounded-[28%] bg-paper"
          faceClassName="-rotate-45"
          face="•‿•"
        />
        <AgentShape
          className="right-[19%] bottom-[17%] h-[85px] w-[130px] -rotate-12"
          bodyClassName="bg-ink [clip-path:polygon(0_30%,32%_30%,42%_0,56%_30%,100%_30%,82%_100%,15%_100%)]"
          faceClassName="text-yellow"
          face="•ᴗ•"
        />
        <p className="absolute right-[2vw] bottom-[2vw] text-right text-[10px] leading-[1.5]">
          01 — ONE PERSON, ONE VOTE PER AGENT
          <br />
          EVERY HIRE ON THE LEDGER
        </p>
      </div>
    </section>
  );
}
