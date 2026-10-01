# Commitment format v1 (local walking skeleton)

This is the proposed v1 used by the local demo, not a deployed Cardano format.
No v1 transaction has been submitted. Before step 6 uses it on a testnet, any
schema change must get a new format version and retain the old fixtures.

## Bytes

`frame(x)` is a four-byte unsigned big-endian byte length followed by `x`.
All text is UTF-8. The SHA-256 input, in order, is:

1. `frame("cardano-ai-preregistry")`
2. Format version as uint16 big-endian (`0001`).
3. `frame(network_id)`, either `preprod:1` or `devnet:42`.
4. A fresh 32-byte CSPRNG salt, fixed width (no length prefix).
5. `frame(RFC8785_JCS(manifest))`.

The network ID includes protocol magic; commitments on different networks do
not share hashes. `network` in the public payload names the corresponding
fixed network configuration. Other devnet magic values are not supported by
this skeleton. Public hashes and exported salt use lowercase hex.

The parser rejects duplicate keys, unsafe integral numbers, nonfinite numbers
and unpaired Unicode surrogates. Large integer identifiers must be strings.
Unicode is not NFC-normalized. The schema requires UTC deadlines at whole
seconds (`YYYY-MM-DDTHH:mm:ssZ`) and fixes dataset IDs, roles, versions and
SHA-256 digests; experiment IDs, model IDs/versions, settings, metric methods
and positive planned run counts. Dataset roles are evaluation/retrieval/training.
Unused roles may be omitted; an experiment may have no datasets. The digest
in the example is a placeholder, not a verified dataset.

## Local records and drafts

The fake public payload whitelist is `app`, `format_version`, `network`,
`commitment_hash`, `reveal_deadline`. The fake reader adds `tx_hash`,
`block_time`, `registrant`, `source`. These generated IDs/times and the demo
registrant are local simulation data, not blockchain or wallet evidence.

The private comparison draft contains `format_version`, `network`, `tx_hash`,
`manifest`, `salt_hex`. It is not the step 7 RevealBundle: results, file hashes,
external URLs and signed chain announcements are not implemented here.
Downloading it creates a local file; the application sends none of its
contents to a server. Reloading the page clears fake-chain records.

The verifier reads the referenced public record through `ChainReader`,
checks network/app/format/reference, recomputes the manifest commitment and
compares the public deadline separately. Every result includes the verification
boundary. A reader error or invalid draft cannot produce a match.

## Fixtures

`tests/fixtures/spike-vectors.json` preserves the 11 JCS/SHA-256 concatenation
vectors from the spike, including one unsafe-integer rejection. Those are v0
under a different domain and do not define the product v1.

`tests/fixtures/commitment-v1.json` contains four independent Python-generated
v1 vectors. `scripts/generate-vectors.py` uses `rfc8785==0.1.4`; the TypeScript
tests consume its saved bytes/hashes without regenerating expected values.
The generator is not required for `make check`. Run it with the existing
spike virtualenv if installed, then inspect any fixture change before use.
