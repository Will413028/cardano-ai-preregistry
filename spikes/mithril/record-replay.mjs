// Throwaway spike: record aggregator responses through global fetch, then replay offline and tamper.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { MithrilClient } from "@mithril-dev/mithril-client-wasm/dist/node/mithril_client_wasm.js";

const AGG = "https://aggregator.release-preprod.api.mithril.network/aggregator";
const GVK = readFileSync(new URL("./fixtures/preprod-genesis.vkey", import.meta.url), "utf8").trim();
const FILE = new URL("./local/preprod-recording.json", import.meta.url);
const [mode, tamper = "none", ...txs] = process.argv.slice(2);
const realFetch = globalThis.fetch;
const log = existsSync(FILE) && mode === "replay" ? JSON.parse(readFileSync(FILE, "utf8")) : {};
let calls = 0;

globalThis.fetch = async (input, init) => {
  calls++;
  const url = typeof input === "string" ? input : input.url;
  const body = init?.body ? String(init.body) : "";
  const key = `${init?.method ?? "GET"} ${url} ${body}`;
  if (mode === "record") {
    const res = await realFetch(input, init);
    const text = await res.text();
    log[key] = { status: res.status, headers: Object.fromEntries(res.headers), text };
    return withUrl(new Response(text, { status: res.status, headers: res.headers }), url);
  }
  const hit = log[key];
  if (!hit) throw new Error(`offline: no recording for ${key}`);
  let text = hit.text;
  text = applyTamper(tamper, url, text);
  return withUrl(new Response(text, { status: hit.status, headers: { "content-type": "application/json" } }), url);
};

// reqwest's wasm backend reads Response.url, which a constructed Response leaves empty.
function withUrl(res, url) {
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function applyTamper(kind, url, text) {
  if (kind === "proof-other-tx" && url.includes("/proof/v2/")) {
    return text.replaceAll("694698814e8a01df5f635d19548d6177800389e3af480a9976f226ee3b12ec93", "12bdb3fc4b4caec00dd36b75c466571c1d5f84ad139988e36283e43e0e2f94af");
  }
  if (kind.startsWith("proof-other-cert") && url.includes("/proof/v2/")) {
    return text.replace("ea71419ec558a7fe7c47077bfc7d4c2b1b24b223341115e5dfe0d471744af669", "537960252923578e64a5695a2cedfbafce34a5cc5bb775b21fad8ac55e46cbc9");
  }
  if (kind === "proof-slot" && url.includes("/proof/v2/")) {
    return text.replace("136492696", "136492697");
  }
  if (kind === "break-chain" && url.includes("/certificate/")) {
    const j = JSON.parse(text);
    if (j.previous_hash && calls > 4) { j.previous_hash = j.previous_hash.replace(/^./, (c) => (c === "0" ? "1" : "0")); return JSON.stringify(j); }
  }
  if (kind === "cert-message" && url.includes("/certificate/")) {
    const j = JSON.parse(text);
    if (calls <= 3 && j.protocol_message?.message_parts) {
      for (const k of Object.keys(j.protocol_message.message_parts)) {
        if (/merkle/i.test(k)) j.protocol_message.message_parts[k] = "00".repeat(32);
      }
      return JSON.stringify(j);
    }
  }
  return text;
}

const gvk = tamper === "other-genesis" ? readFileSync(new URL("./fixtures/preview-genesis.vkey", import.meta.url), "utf8").trim() : GVK;
try {
  const client = new MithrilClient(AGG, gvk, { unstable: true });
  const proof = await client.get_cardano_transaction_v2_proof(txs);
  for (const t of proof.certified_transactions) console.log("certified", t.transaction_hash, t.block_number, t.slot_number);
  const cert = await client.verify_certificate_chain(proof.certificate_hash);
  const msg = await client.verify_cardano_transaction_v2_proof_then_compute_message(proof, cert);
  console.log("computed message parts", JSON.stringify(msg?.message_parts ?? msg).slice(0, 300));
  const ok = tamper.endsWith("-skip-match") ? "skipped" : await client.verify_message_match_certificate(msg, cert);
  console.log("RESULT", tamper, "message_match", ok);
} catch (e) {
  console.log("RESULT", tamper, "error", String(e?.message ?? e).slice(0, 300));
}
console.log("fetch calls", calls);
if (mode === "record") writeFileSync(FILE, JSON.stringify(log));
