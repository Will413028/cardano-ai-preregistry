import recording from '../../fixtures/chain/mithril-preprod.json';

export const SAMPLE_TX = '694698814e8a01df5f635d19548d6177800389e3af480a9976f226ee3b12ec93';
export const OTHER_TX = '12bdb3fc4b4caec00dd36b75c466571c1d5f84ad139988e36283e43e0e2f94af';
export const LEAF = 'ea71419ec558a7fe7c47077bfc7d4c2b1b24b223341115e5dfe0d471744af669';
/** A valid certificate in the same chain that signs a stake distribution, not the transactions root. */
export const OTHER_CERT = '537960252923578e64a5695a2cedfbafce34a5cc5bb775b21fad8ac55e46cbc9';
type Json = Record<string, unknown>;
export type Tamper = (path: string, body: Json) => Json;

/** Offline aggregator: serves the recorded responses, optionally altered; any other request fails, so nothing goes online. */
export function replay(tamper: Tamper = (_path, body) => body, aggregator = recording.aggregator, uncertified = true): typeof fetch {
  const responses = recording.responses as Record<string, Json>;
  return async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(aggregator + '/')) throw new Error(`offline: unexpected host for ${url}`);
    const path = url.slice(aggregator.length);
    const proof = path.match(/^\/proof\/v2\/cardano-transaction\?transaction_hashes=([0-9a-f]{64})$/);
    const sample = `/proof/v2/cardano-transaction?transaction_hashes=${SAMPLE_TX}`;
    let body = responses[path] ?? (proof && !uncertified ? responses[sample] : undefined);
    if (!body && proof && proof[1] !== SAMPLE_TX) {
      // The aggregator's answer for a transaction it has not certified (yet).
      body = { ...responses[sample], certified_transactions: { items: [], proof: '' }, non_certified_transactions: [proof[1]] };
    }
    if (!body) throw new Error(`offline: no recording for ${path}`);
    const response = Response.json(tamper(path, structuredClone(body)));
    // The WASM HTTP client reads Response.url, which a constructed Response leaves empty.
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
}
