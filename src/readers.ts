import { type ChainReader, type Inclusion, type RawTransaction } from './chain.ts';
import { type ChainNetwork } from './commitment.ts';
import { KoiosTransactions, MithrilInclusion, public_reader } from './mithril.ts';

export const DEVNET_API = 'http://127.0.0.1:18080/api/v1';
export const KOIOS_PREPROD = 'https://preprod.koios.rest/api/v1';
const HASH = /^[0-9a-f]{64}$/;

/**
 * devnet has no Mithril: bytes come from the signed transactions kept locally (Yaci Store 0.1 stores no CBOR) and
 * the local indexer confirms the transaction is on the local chain. Output is labelled local trust (I9).
 */
export class DevnetReader implements ChainReader {
  constructor(private readonly signed: Map<string, string>, private readonly base = DEVNET_API, private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async get_transaction(tx_hash: string, network: ChainNetwork): Promise<RawTransaction | null> {
    const cbor = this.signed.get(tx_hash);
    return network === 'devnet' && cbor && HASH.test(tx_hash) ? { cbor } : null;
  }
  /** The local indexer confirms the transaction is on the local chain; its block time is locally trusted. */
  async get_inclusion(tx_hash: string): Promise<Inclusion> {
    // Yaci reports the block time only with metadata; app transactions always carry metadata.
    const info = await this.read(`/txs/${tx_hash}`) as { hash?: unknown; invalid?: unknown; slot?: unknown } | null;
    const metadata = await this.read(`/txs/${tx_hash}/metadata`) as { block_time?: unknown; slot?: unknown }[] | null;
    if (!info || !metadata) throw new Error('The local devnet indexer does not have this transaction yet.');
    const time = metadata[0]?.block_time;
    if (info.hash !== tx_hash || info.invalid !== false || !Number.isSafeInteger(time) || metadata.some(m => m.slot !== info.slot)) throw new Error('Invalid local transaction context.');
    return { status: 'local', trust: 'local-node', time: new Date(Number(time) * 1000).toISOString() };
  }
  private async read(path: string): Promise<unknown> {
    const response = await this.fetcher(this.base + path, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Local devnet indexer unavailable.');
    return response.json();
  }
}

/** The optional development cache `/api/cardano`; untrusted like any transport, so it serves only raw bytes. */
export class ProxyTransactions {
  constructor(private readonly base = '/api/cardano', private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async get_transaction(tx_hash: string, network: ChainNetwork): Promise<RawTransaction | null> {
    if (network !== 'preprod') return null;
    const response = await this.fetcher(`${this.base}?${new URLSearchParams({ kind: 'tx', network, tx_hash })}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Chain read unavailable; keep your private draft and retry.');
    const value = await response.json() as RawTransaction | null;
    return value && typeof value.cbor === 'string' ? { cbor: value.cbor } : null;
  }
}

export type Transport = 'direct' | 'proxy';
/** Dispatches by network; the Mithril instance is shared so certificates verified once are reused. */
export function web_reader(transport: Transport, devnet_signed: Map<string, string>, mithril: MithrilInclusion): ChainReader {
  const devnet = new DevnetReader(devnet_signed);
  const preprod = public_reader(transport === 'proxy' ? new ProxyTransactions() : new KoiosTransactions(KOIOS_PREPROD), mithril);
  const pick = (network: ChainNetwork) => network === 'devnet' ? devnet : preprod;
  return {
    get_transaction: (hash, network) => network === 'devnet' || network === 'preprod' ? pick(network).get_transaction(hash, network) : Promise.resolve(null),
    get_inclusion: (hash, network) => pick(network).get_inclusion(hash, network),
  };
}
