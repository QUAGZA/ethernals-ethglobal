import { formatPriceShort, parseUnits6 } from "@ethernals/shared";

/** "0.116666" -> "0.117". Leaves anything that is not an amount (e.g. "—") as it is. */
export function shortUsdc(amount: string | null | undefined): string {
  if (!amount) return "—";
  try {
    return formatPriceShort(parseUnits6(amount));
  } catch {
    return amount;
  }
}

/** "0.116666" -> "0.12" for balances. */
export function usdc2(amount: string | null | undefined): string {
  if (!amount) return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

export function timeOf(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function dateTimeOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** 0x1234567890abcdef -> 0x1234…cdef */
export function shortHex(value: string | null | undefined, keep = 4): string {
  if (!value) return "—";
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep + 2)}…${value.slice(-keep)}`;
}

/** "summarize.ethernals.eth" -> "summarize", given the parent name. */
export function labelOf(ensName: string, ensParent?: string | null): string {
  if (ensParent && ensName.endsWith(`.${ensParent}`)) return ensName.slice(0, -(ensParent.length + 1));
  return ensName.split(".")[0];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
