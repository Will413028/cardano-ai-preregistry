// Throwaway spike: fetch and verify a Mithril v2 transaction proof on preprod (Node target).
import { readFileSync } from "node:fs";
import { MithrilClient } from "@mithril-dev/mithril-client-wasm/dist/node/mithril_client_wasm.js";

const AGG = "https://aggregator.release-preprod.api.mithril.network/aggregator";
const GVK = readFileSync(new URL("./fixtures/preprod-genesis.vkey", import.meta.url), "utf8").trim();
const txs = process.argv.slice(2);
const t0 = performance.now();
const client = new MithrilClient(AGG, GVK, { unstable: true });
const proof = await client.get_cardano_transaction_v2_proof(txs);
const t1 = performance.now();
console.log("certificate_hash", proof.certificate_hash);
console.log("latest_block_number", proof.latest_block_number, "k", proof.security_parameter);
console.log("non_certified", proof.non_certified_transactions);
for (const t of proof.certified_transactions) console.log("certified", t.transaction_hash, t.block_number, t.slot_number, t.block_hash);
const cert = await client.verify_certificate_chain(proof.certificate_hash);
const t2 = performance.now();
const msg = await client.verify_cardano_transaction_v2_proof_then_compute_message(proof, cert);
const ok = await client.verify_message_match_certificate(msg, cert);
const t3 = performance.now();
console.log("message_match", ok);
console.log("ms proof", (t1 - t0).toFixed(0), "chain", (t2 - t1).toFixed(0), "verify", (t3 - t2).toFixed(0));
console.log("cert keys", Object.keys(cert));
console.log("cert signed_entity_type", JSON.stringify(cert.signed_entity_type ?? cert.beacon));
