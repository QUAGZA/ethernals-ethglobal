/**
 * Handle claims on-chain. A handle is claimed by writing records on `<handle>.people.<parent>` in ENS:
 * an HMAC of the person's World ID nullifier (same human, no leak), their public provider key, and their person id
 * sealed with the platform root secret. Any server reads the claim, so a handle is unique across servers and the same
 * human gets the same identity (and the same agents) everywhere.
 */
import { ENS_KEYS } from "@ethernals/shared";
import { normalize } from "viem/ens";
import { config } from "./config";
import { decryptSecret, encryptSecret, nullifierHash, providerKey } from "./crypto";
import type { PersonRow } from "./db";
import { readText, setRecords } from "./ens";
import { log } from "./events";

export interface HandleClaim {
  nullhash: string;
  owner: string | null;
  /** The person id sealed in the claim, or null if it cannot be opened with this server's secret. */
  personId: string | null;
}

export const peopleName = (handle: string): string => normalize(`${handle}.people.${config.ens.parent()}`);

/** The claim on a handle, null when unclaimed. Throws when ENS cannot be read. */
export async function readHandleClaim(handle: string): Promise<HandleClaim | null> {
  const name = peopleName(handle);
  const nullhash = await readText(name, ENS_KEYS.nullhash);
  if (!nullhash) return null;
  const [owner, pid] = await Promise.all([readText(name, ENS_KEYS.owner).catch(() => null), readText(name, ENS_KEYS.pid).catch(() => null)]);
  let personId: string | null = null;
  try {
    if (pid) personId = decryptSecret(pid);
  } catch {
    /* sealed with another root secret */
  }
  return { nullhash, owner, personId };
}

const published = new Set<string>();

/** Claims the person's handle in ENS (once per process per handle). Failures are logged, never thrown. */
export function publishHandleClaim(person: PersonRow, nullifier: string): void {
  if (person.mode === "dev" || published.has(person.handle)) return;
  published.add(person.handle);
  void setRecords(peopleName(person.handle), {
    [ENS_KEYS.nullhash]: nullifierHash(nullifier),
    [ENS_KEYS.owner]: providerKey(person.id),
    [ENS_KEYS.pid]: encryptSecret(person.id),
    [ENS_KEYS.updated]: new Date().toISOString(),
  }).catch((err) => {
    published.delete(person.handle);
    log.error(`handle claim for @${person.handle} failed`, err);
  });
}

/** For someone already registered here: make sure their claim exists on-chain. */
export async function ensureHandleClaim(person: PersonRow, nullifier: string): Promise<void> {
  if (person.mode === "dev" || published.has(person.handle)) return;
  try {
    const claim = await readHandleClaim(person.handle);
    if (claim) published.add(person.handle);
    else publishHandleClaim(person, nullifier);
  } catch (err) {
    log.warn(`could not check the on-chain claim for @${person.handle}`, { error: (err as Error).message });
  }
}
