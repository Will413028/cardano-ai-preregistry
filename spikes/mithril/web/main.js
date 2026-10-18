// Throwaway spike: verify a Mithril v2 transaction proof in the browser.
import initMithrilClient, { MithrilClient } from "@mithril-dev/mithril-client-wasm";
import gvk from "../fixtures/preprod-genesis.vkey?raw";

const AGG = "https://aggregator.release-preprod.api.mithril.network/aggregator";
const params = new URLSearchParams(location.search);
const tx = params.get("tx");
const cache = params.get("cache") === "1";
const out = document.getElementById("out");
const result = { tx, cache };
// Longest gap between timer ticks shows whether verification blocks the main thread.
let last = performance.now(), maxGap = 0;
const tick = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 50);
try {
  const t0 = performance.now();
  await initMithrilClient();
  const t1 = performance.now();
  const client = new MithrilClient(AGG, gvk.trim(), { unstable: true, enable_certificate_chain_verification_cache: cache });
  const proof = await client.get_cardano_transaction_v2_proof([tx]);
  const t2 = performance.now();
  const cert = await client.verify_certificate_chain(proof.certificate_hash);
  const t3 = performance.now();
  const msg = await client.verify_cardano_transaction_v2_proof_then_compute_message(proof, cert);
  const ok = await client.verify_message_match_certificate(msg, cert);
  const t4 = performance.now();
  Object.assign(result, {
    ok,
    certified: proof.certified_transactions.map((t) => ({ hash: t.transaction_hash, block: String(t.block_number), slot: String(t.slot_number) })),
    ms: { init: Math.round(t1 - t0), proof: Math.round(t2 - t1), chain: Math.round(t3 - t2), verify: Math.round(t4 - t3) },
  });
} catch (e) {
  result.error = String(e?.message ?? e).slice(0, 400);
}
clearInterval(tick);
result.maxMainThreadGapMs = Math.round(maxGap);
result.storage = { local: Object.keys(localStorage), session: Object.keys(sessionStorage), idb: (await indexedDB.databases()).map((d) => d.name) };
out.textContent = JSON.stringify(result);
out.dataset.done = "1";
