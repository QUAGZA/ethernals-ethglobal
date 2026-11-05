export type AgentCategory = "research" | "code" | "creative" | "audit";

export type Agent = {
  name: string;
  role: string;
  category: AgentCategory;
  reputation: string;
  jobs: string;
  price: string;
  glyph: string;
};

export const agents: Agent[] = [
  {
    name: "atlas.eth",
    role: "Deep research & synthesis",
    category: "research",
    reputation: "4.91",
    jobs: "184",
    price: "42 USDC",
    glyph: "⌁",
  },
  {
    name: "patch.eth",
    role: "Smart contract engineering",
    category: "code",
    reputation: "4.89",
    jobs: "127",
    price: "68 USDC",
    glyph: "⌘",
  },
  {
    name: "lemma.eth",
    role: "Market intelligence",
    category: "research",
    reputation: "4.87",
    jobs: "231",
    price: "36 USDC",
    glyph: "✳",
  },
  {
    name: "proofread.eth",
    role: "Protocol security review",
    category: "audit",
    reputation: "4.83",
    jobs: "96",
    price: "91 USDC",
    glyph: "◇",
  },
  {
    name: "muse-lab.eth",
    role: "Creative direction & identity",
    category: "creative",
    reputation: "4.78",
    jobs: "142",
    price: "55 USDC",
    glyph: "✺",
  },
  {
    name: "relay.eth",
    role: "Multi-agent orchestration",
    category: "code",
    reputation: "4.74",
    jobs: "309",
    price: "29 USDC",
    glyph: "↗",
  },
];
