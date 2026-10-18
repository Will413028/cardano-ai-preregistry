import { canonicalize, type Manifest } from './manifest.ts';

export const DOMAIN = 'cardano-ai-preregistry';
/** New registrations use v2; v1 stays verifiable for the devnet transactions already made with it. */
export const FORMAT_VERSIONS = [1, 2] as const;
export type FormatVersion = typeof FORMAT_VERSIONS[number];
export const FORMAT_VERSION: FormatVersion = 2;
export const NETWORKS = { preprod: 'preprod:1', devnet: 'devnet:42' } as const;
export type Network = keyof typeof NETWORKS;
/** Networks a reveal may claim; only NETWORKS carry commitments in this MVP. */
export const CHAIN_NETWORKS = ['mainnet', 'preprod', 'preview', 'devnet'] as const;
export type ChainNetwork = typeof CHAIN_NETWORKS[number];
export function is_network(value: unknown): value is Network { return typeof value === 'string' && Object.hasOwn(NETWORKS, value); }

export function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export function unhex(value: string, length: number): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) throw new Error(`Expected ${length} bytes as lowercase hex.`);
  return Uint8Array.from(value.match(/../g)!, s => parseInt(s, 16));
}
export function new_salt(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)); }
export async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));
}
const utf8 = (value: string) => new TextEncoder().encode(value);
function frame(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0xffffffff) throw new Error('Field exceeds uint32 length.');
  const result = new Uint8Array(bytes.length + 4);
  new DataView(result.buffer).setUint32(0, bytes.length, false);
  result.set(bytes, 4); return result;
}

/** v1 and the spike vectors have no registrant; v2 frames the 28-byte registrant payment key hash after the network. */
export function encode_bytes(canonical: string, salt: Uint8Array, network: string, domain = DOMAIN, version = 1, registrant?: Uint8Array): Uint8Array {
  if (salt.length !== 32) throw new Error('salt must be 32 bytes.');
  if (!Number.isInteger(version) || version < 0 || version > 65535) throw new Error('Invalid format version.');
  if (version >= 2 ? registrant?.length !== 28 : registrant !== undefined) throw new Error('Format v2 requires exactly a 28-byte registrant key hash.');
  const version_bytes = new Uint8Array(2);
  new DataView(version_bytes.buffer).setUint16(0, version, false);
  const fields = [frame(utf8(domain)), version_bytes, frame(utf8(network)), ...(registrant ? [frame(registrant)] : []), salt, frame(utf8(canonical))];
  const result = new Uint8Array(fields.reduce((n, x) => n + x.length, 0));
  let offset = 0;
  for (const field of fields) { result.set(field, offset); offset += field.length; }
  return result;
}

/** Format v2 binds the commitment to its registrant, so another key cannot claim a copied hash (D14). */
export async function encode_commitment(manifest: Manifest, salt: Uint8Array, network: Network, registrant: string): Promise<string> {
  if (!Object.hasOwn(NETWORKS, network)) throw new Error('Unsupported network.');
  return sha256(encode_bytes(canonicalize(manifest), salt, NETWORKS[network], DOMAIN, 2, unhex(registrant, 28)));
}
/** Legacy v1 recomputation for verifying existing devnet commitments; never used for new registrations. */
export async function encode_commitment_v1(manifest: Manifest, salt: Uint8Array, network: Network): Promise<string> {
  if (!Object.hasOwn(NETWORKS, network)) throw new Error('Unsupported network.');
  return sha256(encode_bytes(canonicalize(manifest), salt, NETWORKS[network]));
}
