import { Arena } from "@/components/arena";
import { Hero } from "@/components/hero";
import { Market } from "@/components/market";
import { Protocol } from "@/components/protocol";
import { Ticker } from "@/components/ticker";

export default function Home() {
  return (
    <>
      <Hero />
      <Ticker />
      <Market />
      <Arena />
      <Protocol />
    </>
  );
}
