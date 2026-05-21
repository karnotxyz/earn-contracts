import { RpcProvider } from "starknet";

export interface DetectedChain {
  chainId: string;
  rawChainId: string;
  label: string;
  networkClass: "mainnet" | "testnet" | "unknown";
}

const STARKNET_HEX_TO_NAME: Record<string, string> = {
  "0x534e5f4d41494e": "SN_MAIN",
  "0x534e5f5345504f4c4941": "SN_SEPOLIA",
};

const KNOWN_CHAINS: Record<string, Omit<DetectedChain, "rawChainId">> = {
  SN_MAIN: {
    chainId: "SN_MAIN",
    label: "Starknet Mainnet",
    networkClass: "mainnet",
  },
  SN_SEPOLIA: {
    chainId: "SN_SEPOLIA",
    label: "Starknet Sepolia",
    networkClass: "testnet",
  },
};

export function normalizeStarknetChainId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed in KNOWN_CHAINS) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const mapped = STARKNET_HEX_TO_NAME[lower];
  if (mapped) {
    return mapped;
  }

  try {
    const hex = BigInt(trimmed).toString(16);
    const normalizedHex = hex.length % 2 === 0 ? hex : `0${hex}`;
    const decoded = Buffer.from(normalizedHex, "hex").toString("utf8");
    if (decoded in KNOWN_CHAINS) {
      return decoded;
    }
  } catch {
    // Keep the original value below for unknown/custom chains.
  }

  return trimmed;
}

export function describeStarknetChain(raw: string): DetectedChain {
  const chainId = normalizeStarknetChainId(raw);
  const known = KNOWN_CHAINS[chainId];
  if (known) {
    return {
      ...known,
      rawChainId: raw,
    };
  }

  return {
    chainId,
    rawChainId: raw,
    label: `Starknet ${chainId}`,
    networkClass: "unknown",
  };
}

export async function detectStarknetChain(rpcUrl: string): Promise<DetectedChain> {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const rawChainId = await provider.getChainId();
  return describeStarknetChain(rawChainId);
}

export function assertChainMatches(configuredChainId: string, detected: DetectedChain): void {
  const configured = normalizeStarknetChainId(configuredChainId);
  if (configured !== detected.chainId) {
    throw new Error(
      `RPC chain mismatch: config expects ${configured}, but RPC returned ${detected.chainId}`,
    );
  }
}

export function isMainnetChainId(chainId: string): boolean {
  return normalizeStarknetChainId(chainId) === "SN_MAIN";
}
