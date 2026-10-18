import { type ChainReader, type Inclusion, type RawTransaction } from './chain.ts';
import { type ChainNetwork } from './commitment.ts';

/**
 * Trust roots are compiled in, never fetched (I9). preprod and preview share this genesis key, so it separates
 * testnets from mainnet but not preprod from preview (D16). Source: IntersectMBO/mithril
 * mithril-infra/configuration/release-preprod/genesis.vkey, checked 2026-10-18.
 */
export const TESTNET_GENESIS_VKEY = '5b3132372c37332c3132342c3136312c362c3133372c3133312c3231332c3230372c3131372c3139382c38352c3137362c3139392c3136322c3234312c36382c3132332c3131392c3134352c31332c3233322c3234332c34392c3232392c322c3234392c3230352c3230352c33392c3233352c34345d';
/**
 * release-mainnet/genesis.vkey, checked 2026-10-18. No app path reaches it today (no mainnet transaction source, D10);
 * it pins what a mainnet claim would be checked against, and tests show preprod data cannot pass under it. I9 itself
 * rests on payloads naming only NETWORKS and preprod using the testnet key.
 */
export const MAINNET_GENESIS_VKEY = '5b3139312c36362c3134302c3138352c3133382c31312c3233372c3230372c3235302c3134342c32372c322c3138382c33302c31322c38312c3135352c3230342c31302c3137392c37352c32332c3133382c3139362c3231372c352c31342c32302c35372c37392c33392c3137365d';
export const MITHRIL_NETWORKS: Partial<Record<ChainNetwork, { aggregator: string; genesis_vkey: string }>> = {
  preprod: { aggregator: 'https://aggregator.release-preprod.api.mithril.network/aggregator', genesis_vkey: TESTNET_GENESIS_VKEY },
  mainnet: { aggregator: 'https://aggregator.release-mainnet.api.mithril.network/aggregator', genesis_vkey: MAINNET_GENESIS_VKEY },
};
/**
 * Era boundaries as constants so a block time never comes from a transport. preprod: Byron from 2022-06-01T00:00:00Z
 * with 20 s slots (byron-genesis startTime 1654041600, slotDuration 20000), Shelley and later from slot 86400 (epoch 4)
 * with 1 s slots (shelley-genesis slotLength 1).
 */
const ERAS: Partial<Record<ChainNetwork, { slot: number; time: number; slot_seconds: number }[]>> = {
  preprod: [{ slot: 0, time: 1654041600, slot_seconds: 20 }, { slot: 86400, time: 1655769600, slot_seconds: 1 }],
};
export function slot_time(network: ChainNetwork, slot: number): string {
  const era = ERAS[network]?.findLast(e => e.slot <= slot);
  if (!era || !Number.isSafeInteger(slot) || slot < 0) throw new Error(`No slot schedule for ${network}.`);
  return new Date((era.time + (slot - era.slot) * era.slot_seconds) * 1000).toISOString();
}

interface Wasm {
  MithrilClient: new (aggregator: string, genesis_vkey: string, options: object) => MithrilClient;
}
interface Proof {
  certificate_hash: string;
  certified_transactions: { transaction_hash: string; slot_number: bigint; block_number: bigint }[];
  non_certified_transactions: string[];
}
interface MithrilClient {
  get_cardano_transaction_v2_proof(hashes: string[]): Promise<Proof>;
  get_mithril_certificate(hash: string): Promise<unknown>;
  verify_certificate_chain(hash: string): Promise<unknown>;
  verify_cardano_transaction_v2_proof_then_compute_message(proof: Proof, certificate: unknown): Promise<unknown>;
  verify_message_match_certificate(message: unknown, certificate: unknown): Promise<boolean>;
}
let wasm: Promise<Wasm> | null = null;
/** The browser build needs an explicit init; the Node build used by tests is ready on import. */
async function load(): Promise<Wasm> {
  wasm ??= import('@mithril-dev/mithril-client-wasm').then(async module => {
    const init = (module as { default?: unknown }).default;
    if (typeof init === 'function') await (init as () => Promise<unknown>)();
    return module as unknown as Wasm;
  }).catch(error => { wasm = null; throw error; });  // a failed download can be retried without a reload
  return wasm;
}

export interface MithrilOptions {
  /** Keeps verified certificates in this browser's IndexedDB; a cold chain check takes about a minute (spike-mithril.md). */
  cache?: boolean;
}
/** Verifies transaction inclusion with a Mithril v2 proof; the aggregator is only a transport. */
export class MithrilInclusion {
  private readonly clients = new Map<ChainNetwork, MithrilClient>();
  /** Certificates this instance already verified to genesis; later proofs signed by them skip the slow chain walk. */
  private readonly verified = new Map<string, unknown>();  // keyed by network and certificate hash
  constructor(private readonly options: MithrilOptions = {}) {}
  private async client(network: ChainNetwork): Promise<MithrilClient> {
    const config = MITHRIL_NETWORKS[network];
    if (!config) throw new Error(`Mithril verification is not configured for ${network}.`);
    let client = this.clients.get(network);
    if (!client) {
      const { MithrilClient } = await load();
      client = new MithrilClient(config.aggregator, config.genesis_vkey,
        { unstable: true, enable_certificate_chain_verification_cache: this.options.cache === true });
      this.clients.set(network, client);
    }
    return client;
  }
  async get_inclusion(tx_hash: string, network: ChainNetwork): Promise<Inclusion> {
    const client = await this.client(network);
    const proof = await client.get_cardano_transaction_v2_proof([tx_hash]);
    const item = proof.certified_transactions.find(t => t.transaction_hash === tx_hash);
    if (!item) return { status: 'pending', trust: 'mithril' };
    // Reject a proof that does not match its own certificate before the slow chain check.
    const unverified = await client.get_mithril_certificate(proof.certificate_hash);
    if (await this.matches(client, proof, unverified) !== true) throw new Error('Mithril proof does not match its certificate.');
    // Keyed by network too: a certificate verified to one genesis key says nothing under another network's key.
    const key = `${network}:${proof.certificate_hash}`;
    let certificate = this.verified.get(key);
    if (certificate === undefined) {
      certificate = await client.verify_certificate_chain(proof.certificate_hash);
      this.verified.set(key, certificate);
    }
    if (await this.matches(client, proof, certificate) !== true) throw new Error('Mithril proof does not match its certificate.');
    return { status: 'certified', trust: 'mithril', slot: Number(item.slot_number), block_number: Number(item.block_number) };
  }
  /** `…then_compute_message` does not compare the Merkle root; only this call does, and it returns false rather than throwing. */
  private async matches(client: MithrilClient, proof: Proof, certificate: unknown): Promise<boolean> {
    const message = await client.verify_cardano_transaction_v2_proof_then_compute_message(proof, certificate);
    return client.verify_message_match_certificate(message, certificate);
  }
}

/** Untrusted raw-bytes transport over Koios `tx_cbor`; any result is checked by `verify_transaction`. */
export class KoiosTransactions {
  constructor(private readonly base = 'https://preprod.koios.rest/api/v1', private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async get_transaction(tx_hash: string, network: ChainNetwork): Promise<RawTransaction | null> {
    if (network !== 'preprod') return null;
    const response = await this.fetcher(`${this.base}/tx_cbor`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _tx_hashes: [tx_hash] }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Chain provider unavailable.');
    const rows = await response.json() as { tx_hash?: unknown; cbor?: unknown }[];
    const row = Array.isArray(rows) ? rows.find(r => r?.tx_hash === tx_hash) : undefined;
    return row && typeof row.cbor === 'string' ? { cbor: row.cbor } : null;
  }
}
/** Public-network reader: bytes from any transport, inclusion and slot from Mithril. */
export function public_reader(transactions: Pick<ChainReader, 'get_transaction'>, inclusion: MithrilInclusion): ChainReader {
  return { get_transaction: (hash, network) => transactions.get_transaction(hash, network), get_inclusion: (hash, network) => inclusion.get_inclusion(hash, network) };
}
