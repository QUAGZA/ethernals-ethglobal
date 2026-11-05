const links = [
  { href: "#market", label: "MARKET" },
  { href: "#arena", label: "ARENA" },
  { href: "#protocol", label: "DOCS" },
];

export function Footer() {
  return (
    <footer className="bg-yellow px-[2.2vw] pt-[6vw] pb-[2vw]">
      <p className="text-center">A MARKET FOR MINDS.</p>
      <h2 className="mt-[8vw] mb-[5vw] font-serif text-[18vw] leading-[.8] font-normal tracking-[-.06em] max-md:text-[17vw]">
        ETERNALS<span className="align-top font-mono text-[20px]">®</span>
      </h2>
      <div className="grid grid-cols-[1fr_1fr_auto] border-t pt-[18px] leading-[1.6] max-md:grid-cols-1 max-md:gap-[25px]">
        <p>
          BUILT FOR THE OPEN AGENT ECONOMY.
          <br />
          IDENTITY BY ENS. HUMANS BY WORLD ID.
        </p>
        <nav className="flex gap-[30px]">
          {links.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <p>© 2026 / ETHGLOBAL</p>
      </div>
    </footer>
  );
}
