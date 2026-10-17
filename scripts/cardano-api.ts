import { type Plugin } from 'vite';
import { is_announcement, validate_announcement, validate_payload, type AnnouncementRecord, type CommitmentRecord } from '../src/chain.ts';
import { METADATA_LABEL } from '../src/registration.ts';
import { type Network } from '../src/commitment.ts';
import { ReadProxy, MemoryReadCache, parse_public_query, type PublicQuery } from '../src/read-proxy.ts';

const DEVNET = 'http://127.0.0.1:18080/api/v1';
const PREPROD = 'https://preprod.koios.rest/api/v1';
async function upstream(url: string, body?: object): Promise<unknown> {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Chain provider unavailable.');
  return response.json();
}
interface PublicTx { payload: unknown; time: number; registrant: string; }
/** Reads label METADATA_LABEL from one valid transaction and derives its single payment-key registrant. */
async function read_public_tx(network: Network, hash: string): Promise<PublicTx | null> {
  const { core } = await import('@meshsdk/core');
  let payload: unknown, time: number, addresses: string[];
  if (network === 'devnet') {
    const metadata = await upstream(`${DEVNET}/txs/${hash}/metadata`) as { label: string; json_metadata: unknown; block_time: number; slot: number }[] | null;
    if (!metadata) return null;
    const entry = metadata.find(m => String(m.label) === String(METADATA_LABEL));
    payload = entry?.json_metadata;
    if (!payload) return null;
    const info = await upstream(`${DEVNET}/txs/${hash}`) as { hash: string; invalid: boolean; slot: number; inputs: { address: string }[] };
    if (info.hash !== hash || info.invalid !== false || info.slot !== entry!.slot) throw new Error('Invalid transaction context.');
    time = entry!.block_time;
    addresses = info.inputs.map(i => i.address);
  } else {
    const records = await upstream(`${PREPROD}/tx_info`, { _tx_hashes: [hash], _inputs: true, _metadata: true }) as
      { tx_hash: string; tx_timestamp: number; valid_contract: boolean; metadata: Record<string, unknown>; inputs: { payment_addr: { bech32: string } }[] }[];
    const record = records.find(r => r.tx_hash === hash);
    if (!record) return null;
    if (record.valid_contract === false) throw new Error('Invalid transaction.');
    payload = record.metadata?.[METADATA_LABEL];
    if (!payload) return null;
    time = record.tx_timestamp; addresses = record.inputs.map(i => i.payment_addr.bech32);
  }
  if (!Number.isSafeInteger(time)) throw new Error('Invalid commitment context.');
  // Only key-spending transactions with one payment identity are supported.
  const keys = addresses.map(address => {
    const decoded = core.Address.fromBech32(address);
    const credential = decoded.getProps().paymentPart;
    if (decoded.getNetworkId() !== 0 || credential?.type !== core.CredentialType.KeyHash) throw new Error('Unsupported registrant address.');
    return core.resolvePaymentKeyHash(address);
  });
  if (!keys.length || new Set(keys).size !== 1) throw new Error('Ambiguous transaction registrant.');
  return { payload, time, registrant: keys[0]! };
}
const context = (network: Network, hash: string, tx: PublicTx) =>
  ({ tx_hash: hash, block_time: new Date(tx.time * 1000).toISOString(), registrant: tx.registrant, source: network });
export async function read_commitment(network: Network, hash: string): Promise<CommitmentRecord | null> {
  const tx = await read_public_tx(network, hash);
  if (!tx || is_announcement(tx.payload)) return null;
  const public_payload = validate_payload(tx.payload as Parameters<typeof validate_payload>[0]);
  if (public_payload.network !== network) throw new Error('Invalid commitment context.');
  return { ...public_payload, ...context(network, hash, tx) };
}
export async function read_announcement(network: Network, hash: string): Promise<AnnouncementRecord | null> {
  const tx = await read_public_tx(network, hash);
  if (!tx || !is_announcement(tx.payload)) return null;
  const public_payload = validate_announcement(tx.payload as Parameters<typeof validate_announcement>[0]);
  if (public_payload.network !== network) throw new Error('Invalid announcement context.');
  return { ...public_payload, ...context(network, hash, tx) };
}

export function cardano_api_plugin(): Plugin {
  const providers = new Map<Network, import('@meshsdk/core').YaciProvider | import('@meshsdk/core').KoiosProvider>();
  const proxy = new ReadProxy({ async read(query) {
    const network = query.network;
    let provider = providers.get(network);
    if (!provider) {
      const { YaciProvider, KoiosProvider } = await import('@meshsdk/core');
      provider = network === 'devnet' ? new YaciProvider(DEVNET) : new KoiosProvider('preprod');
      providers.set(network, provider);
    }
    if (query.kind === 'protocol') return provider.fetchProtocolParameters();
    if (query.kind === 'utxos') return provider.fetchUTxOs(query.tx_hash);
    if (query.kind === 'commitment') return read_commitment(network, query.tx_hash);
    if (query.kind === 'announcement') return read_announcement(network, query.tx_hash);
    throw new Error('Index queries are implemented in step 8.');
  } }, new MemoryReadCache());
  return { name: 'public-cardano-reads', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/cardano') { next(); return; }
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.headers['content-length'] || req.headers['transfer-encoding']) { res.statusCode = 405; res.end('{}'); return; }
      let query: PublicQuery;
      try {
        query = parse_public_query(url);
        if (query.kind === 'label' || query.kind === 'address') throw new Error('Unsupported query.');
      } catch { res.statusCode = 400; res.end('{}'); return; }
      try { res.end(JSON.stringify(await proxy.read(query))); }
      catch { res.statusCode = 502; res.end(JSON.stringify({ error: 'Public chain read unavailable.' })); }
    });
  } };
}
