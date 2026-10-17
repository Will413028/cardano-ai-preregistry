# Commitment format v1

This v1 is used on local devnet test transactions; it is not a mainnet format.
Any schema change must get a new format version and retain the old fixtures.

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

The private draft contains `format_version`, `network`, `tx_hash`,
`manifest`, `salt_hex`. Downloading it creates a local file; the application
sends none of its contents to a server. Reloading the page clears fake-chain records.

`verify_commitment` reads the referenced public record through `ChainReader`,
checks network/app/format/reference, recomputes the manifest commitment and
compares the public deadline separately. Every result includes the verification
boundary. A reader error or invalid draft cannot produce a match.

## Reveal bundle v1

The registrant creates the bundle in the browser and hosts it (D7=A). Fields:
`bundle_version` (1), `app`, `network`, `commitment_tx_hash`, `manifest`,
`salt_hex`, `results` (`experiment_id`, `completed_runs`, `metrics`), `files`
(`path`, `sha256`, `url`) and optional `self_reported_period`
(`started_at`/`finished_at`, UTC whole seconds). Paths and experiment IDs are
unique; file hashes are SHA-256 lowercase hex of the exact hosted bytes.
The published file is `RFC8785_JCS(bundle)` as UTF-8; its SHA-256 is the
bundle hash. A bundle may claim `mainnet` or `preview` so a verifier can report
a network mismatch; commitments exist only on `preprod` and `devnet`.

URLs are printable ASCII, at most 512 bytes, `https` (or `http` on loopback for
local devnet runs) and without credentials. Disclosed files and the bundle are
fetched from these URLs directly, never through the application's read route.

`verify_reveal(bundle, ChainReader, FileFetcher)` first runs the commitment
check, then compares every file hash. Results: `match`, `mismatch`,
`network-mismatch`, `not-found`, `files-unavailable` or `invalid`, with the
commitment block time, network, per-file status, verification boundary and a
note that self-reported times, results and files remain registrant claims.
Results inside a bundle checked alone are not fixed by any hash; only an
announcement fixes them.

## Disclosure announcement v1

Same label 86741, distinguished by `kind`. Exact public fields: `app`,
`format_version` (1), `kind` (`reveal`), `network`, `commitment_tx_hash`,
`bundle_sha256`, `bundle_url`. `bundle_url` is the URL split into text chunks
of 64 bytes; every chunk except the last is full, so the encoding is unique and
reversible. At most 8 chunks. Manifest, salt and results are not in metadata.

The registrant's wallet signs it, and only inputs on the commitment's
registrant payment key are spent. `verify_announcement` reads the announcement,
reads the referenced commitment, requires the same registrant, fetches the
bundle from the announced URL, compares its hash, requires the bundle to name
the same commitment and network, then runs `verify_reveal`. A different signer
is `signer-mismatch`. The announcement block time is reported; it does not
prove that the files were retrievable then. On-time or overdue status is
derived in step 8.

## Fixtures

`tests/fixtures/spike-vectors.json` preserves the 11 JCS/SHA-256 concatenation
vectors from the spike, including one unsafe-integer rejection. Those are v0
under a different domain and do not define the product v1.

`tests/fixtures/commitment-v1.json` contains four independent Python-generated
v1 vectors. `scripts/generate-vectors.py` uses `rfc8785==0.1.4`; the TypeScript
tests consume its saved bytes/hashes without regenerating expected values.
The generator is not required for `make check`. Run it with the existing
spike virtualenv if installed, then inspect any fixture change before use.
