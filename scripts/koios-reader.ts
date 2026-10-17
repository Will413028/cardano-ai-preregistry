/** Read-only: exercises the preprod Koios ChainReader on an existing public transaction outside the app label. */
import { read_announcement, read_commitment } from './cardano-api.ts';

const hash = process.argv[2] ?? '';
if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Expected a public preprod transaction hash.');
const [commitment, announcement] = [await read_commitment('preprod', hash), await read_announcement('preprod', hash)];
if (commitment !== null || announcement !== null) throw new Error('A transaction without label 86741 must not read as an application record.');
console.log('Koios preprod ChainReader passed: public sample has no application commitment or announcement.');
