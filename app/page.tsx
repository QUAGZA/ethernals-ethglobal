import { Arena } from "@/components/arena";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Market } from "@/components/market";
import { Protocol } from "@/components/protocol";
import { Ticker } from "@/components/ticker";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Ticker />
        <Market />
        <Arena />
        <Protocol />
      </main>
      <Footer />
    </>
  );
}
