/**
 * Explorer link helpers and Hedera transaction-id normalization.
 */

/** "0.0.123@1700000000.123456789" or "0.0.123-1700000000-123456789" -> mirror-node form "0.0.123-1700000000-123456789". */
export function toMirrorTxId(txId: string): string {
  const trimmed = txId.trim();
  const at = trimmed.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  if (at) return `${at[1]}-${at[2]}-${at[3].padStart(9, "0")}`;
  const dash = trimmed.match(/^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/);
  if (dash) return `${dash[1]}-${dash[2]}-${dash[3].padStart(9, "0")}`;
  throw new Error(`Not a Hedera transaction id: "${txId}"`);
}

export function isHederaTxId(value: string): boolean {
  try {
    toMirrorTxId(value);
    return true;
  } catch {
    return false;
  }
}

export function hashscanTxUrl(txId: string, network: "testnet" | "mainnet" = "testnet"): string {
  return `https://hashscan.io/${network}/transactionsById/${toMirrorTxId(txId)}`;
}

export function hashscanEvmTxUrl(hash: string, network: "testnet" | "mainnet" = "testnet"): string {
  return `https://hashscan.io/${network}/transaction/${hash}`;
}

export function hashscanAccountUrl(accountId: string, network: "testnet" | "mainnet" = "testnet"): string {
  return `https://hashscan.io/${network}/account/${accountId}`;
}

export function hashscanContractUrl(address: string, network: "testnet" | "mainnet" = "testnet"): string {
  return `https://hashscan.io/${network}/contract/${address}`;
}

export function sepoliaTxUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function sepoliaAddressUrl(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

/** Official ENS app page for a name on Sepolia. */
export function ensAppUrl(name: string): string {
  return `https://sepolia.app.ens.domains/${name}`;
}
