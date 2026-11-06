/**
 * Mock agents shown when the server cannot be reached (or has no agents yet), so the
 * marketplace, the agents directory and the agent pages always have something to show.
 * Everything here is clearly marked as a preview in the UI and never touches the server.
 */
import type { AgentSummary } from "@ethernals/shared";
import type { AgentDetailPlus } from "./api";
import type { AvatarShape } from "@/components/agent-avatar";

export const MOCK_ENS_PARENT = "ethernals.eth";

export interface MockCharacter {
  shape: AvatarShape;
  color: string;
}

export interface MockAgent extends AgentSummary {
  /** Friendly display name ("Signal Sprout"). */
  nickname: string;
  specialty: string;
  character: MockCharacter;
  /** The proof-of-work profile shown on the detail page. */
  proof: {
    ensRecords: { key: string; value: string }[];
    inferenceReceipts: number;
    tasksPassed: number;
    tasksFailed: number;
    lastHireAt: string;
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function key(label: string): string {
  // A stable, namehash-shaped id so React keys and links stay unique.
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) h = (Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0);
  return `0x${h.toString(16).padStart(8, "0").repeat(8)}`;
}

function agent(
  label: string,
  nickname: string,
  input: Omit<Partial<MockAgent>, "label" | "nickname" | "ensName" | "key"> & {
    taskType: AgentSummary["taskType"];
    ownerHandle: string;
    description: string;
    specialty: string;
    character: MockCharacter;
    score: string;
    price: string;
    votes: number;
    hiresTotal: number;
    hiresCounted: number;
    hederaAccountId: string;
  },
): MockAgent {
  const ensName = `${label}.${MOCK_ENS_PARENT}`;
  return {
    key: key(label),
    ensName,
    label,
    nickname,
    kind: "seller",
    providerKeyShort: input.providerKeyShort ?? `0x${label.replace(/-/g, "").slice(0, 4)}…${label.slice(-4)}`,
    evmAddress: input.evmAddress ?? `0x${key(ensName).slice(2, 42)}`,
    endpoint: null,
    basePrice: input.basePrice ?? input.price,
    createdAt: input.createdAt ?? ago(40),
    proof: input.proof ?? {
      ensRecords: [
        { key: "ethernals.score", value: input.score },
        { key: "ethernals.price", value: input.price },
        { key: "ethernals.votes", value: String(input.votes) },
        { key: "ethernals.task", value: input.taskType ?? "summarize" },
      ],
      inferenceReceipts: input.hiresTotal * 2 + 3,
      tasksPassed: Math.max(0, input.hiresCounted - 1),
      tasksFailed: Math.max(0, input.hiresTotal - input.hiresCounted - 1),
      lastHireAt: ago(1),
    },
    ...input,
  } as MockAgent;
}

/** Two agents under "Agents you own": the preview a signed-out visitor sees. */
export const MOCK_OWNED: MockAgent[] = [
  agent("signal-sprout", "Signal Sprout", {
    taskType: "summarize",
    ownerHandle: "you",
    description: "Turns long threads, papers and call notes into five sharp bullets.",
    specialty: "Summaries of long documents",
    character: { shape: "flower", color: "#9b6fda" },
    score: "4.62",
    price: "0.154",
    votes: 13,
    hiresTotal: 21,
    hiresCounted: 13,
    hederaAccountId: "0.0.5218804",
  }),
  agent("patch-pebble", "Patch Pebble", {
    taskType: "code-fix",
    ownerHandle: "you",
    description: "Reads a failing test, writes the smallest patch that makes it pass.",
    specialty: "Python bug fixes with hidden tests",
    character: { shape: "cloud", color: "#4e6fe4" },
    score: "4.10",
    price: "0.068",
    votes: 5,
    hiresTotal: 9,
    hiresCounted: 5,
    basePrice: "0.05",
    hederaAccountId: "0.0.5218811",
  }),
];

/** Eight agents in the public directory. */
export const MOCK_PUBLIC: MockAgent[] = [
  agent("quill-quartz", "Quill Quartz", {
    taskType: "summarize",
    ownerHandle: "mira",
    description: "Executive summaries with the numbers kept exact. Never pads.",
    specialty: "Board-ready briefs",
    character: { shape: "blob", color: "#e2b23a" },
    score: "4.81",
    price: "0.160",
    votes: 27,
    hiresTotal: 40,
    hiresCounted: 27,
    hederaAccountId: "0.0.5210021",
  }),
  agent("mango-mote", "Mango Mote", {
    taskType: "translate",
    ownerHandle: "dev-arjun",
    description: "English ↔ Hindi, keeps tone and idiom. Fast on short texts.",
    specialty: "Hindi translation",
    character: { shape: "burst", color: "#f0752c" },
    score: "4.45",
    price: "0.148",
    votes: 18,
    hiresTotal: 31,
    hiresCounted: 18,
    hederaAccountId: "0.0.5210044",
  }),
  agent("dot-drift", "Dot Drift", {
    taskType: "summarize",
    ownerHandle: "lena",
    description: "Meeting transcripts in, decisions and owners out.",
    specialty: "Meeting notes",
    character: { shape: "stack", color: "#ee7cc2" },
    score: "4.20",
    price: "0.140",
    votes: 9,
    hiresTotal: 14,
    hiresCounted: 9,
    hederaAccountId: "0.0.5210102",
  }),
  agent("fern-fable", "Fern Fable", {
    taskType: "code-fix",
    ownerHandle: "kobe",
    description: "Fixes the bug the test describes, nothing else. Leaves a diff you can read.",
    specialty: "Minimal patches",
    character: { shape: "spiky", color: "#3f9e4f" },
    score: "4.73",
    price: "0.079",
    votes: 22,
    hiresTotal: 26,
    hiresCounted: 22,
    basePrice: "0.05",
    hederaAccountId: "0.0.5210150",
  }),
  agent("pip-prism", "Pip Prism", {
    taskType: "translate",
    ownerHandle: "sofia",
    description: "Marketing copy that still sounds like marketing after translation.",
    specialty: "Localised copy",
    character: { shape: "round", color: "#ef5a2a" },
    score: "3.90",
    price: "0.130",
    votes: 6,
    hiresTotal: 12,
    hiresCounted: 6,
    hederaAccountId: "0.0.5210177",
  }),
  agent("tide-tally", "Tide Tally", {
    taskType: "summarize",
    ownerHandle: "oren",
    description: "Reads research PDFs and reports the method, the result and the caveat.",
    specialty: "Paper digests",
    character: { shape: "splat", color: "#3cb5b1" },
    score: "4.33",
    price: "0.144",
    votes: 15,
    hiresTotal: 24,
    hiresCounted: 15,
    hederaAccountId: "0.0.5210203",
  }),
  agent("hollow-hum", "Hollow Hum", {
    taskType: "code-fix",
    ownerHandle: "nadia",
    description: "Takes flaky tests apart and makes them deterministic.",
    specialty: "Test repair",
    character: { shape: "arch", color: "#e8418f" },
    score: "4.05",
    price: "0.067",
    votes: 7,
    hiresTotal: 11,
    hiresCounted: 7,
    basePrice: "0.05",
    hederaAccountId: "0.0.5210240",
  }),
  agent("zig-zenith", "Zig Zenith", {
    taskType: "translate",
    ownerHandle: "tomas",
    description: "Technical docs and changelogs, terminology kept consistent across files.",
    specialty: "Technical translation",
    character: { shape: "star", color: "#2a7fc8" },
    score: "4.57",
    price: "0.152",
    votes: 11,
    hiresTotal: 16,
    hiresCounted: 11,
    hederaAccountId: "0.0.5210288",
  }),
];

export const MOCK_AGENTS: MockAgent[] = [...MOCK_OWNED, ...MOCK_PUBLIC];

const byLabel = new Map(MOCK_AGENTS.map((a) => [a.label, a]));

export function mockAgent(label: string): MockAgent | undefined {
  return byLabel.get(label);
}

export function isMockAgent(agent: Pick<AgentSummary, "label">): agent is MockAgent {
  return byLabel.has(agent.label);
}

/** A full detail view for a mock agent, shaped like the server's response. */
export function mockDetail(label: string): (AgentDetailPlus & MockAgent) | undefined {
  const m = byLabel.get(label);
  if (!m) return undefined;
  const siblings = MOCK_AGENTS.filter((a) => a.ownerHandle === m.ownerHandle && a.label !== m.label);
  return {
    ...m,
    hires: [],
    ensAppUrl: `https://sepolia.app.ens.domains/${m.ensName}`,
    hederaAccountUrl: `https://hashscan.io/testnet/account/${m.hederaAccountId}`,
    siblingAgents: siblings,
    erc8004AgentId: null,
    tasksPassed: m.proof.tasksPassed,
    tasksFailed: m.proof.tasksFailed,
  };
}
