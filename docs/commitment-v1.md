# Commitment format v1

This v1 is used by existing local devnet test transactions; it is not a mainnet format and is no longer used for new registrations.
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

## Superseded behaviour

New registrations use [format v2](commitment-v2.md), which binds the registrant
into the hash. v1 does not: a v1 match reports that another key could claim the
same commitment. Reading and verifying v1 transactions now follows the v2 trust
model (raw bytes, witness check, Mithril or local trust); the step 7 reader that
trusted provider JSON and input addresses was removed (D13, D14). Bundle and
announcement formats are unchanged and described in the v2 document.

## Fixtures

`tests/fixtures/spike-vectors.json` preserves the 11 JCS/SHA-256 concatenation
vectors from the spike, including one unsafe-integer rejection. Those are v0
under a different domain and do not define the product v1.

`tests/fixtures/commitment-v1.json` contains four independent Python-generated
v1 vectors; `tests/fixtures/chain/devnet-v1.json` holds the two real v1 devnet
transactions from step 7. `scripts/generate-vectors.py` uses `rfc8785==0.1.4`; the TypeScript
tests consume its saved bytes/hashes without regenerating expected values.
The generator is not required for `make check`. Run it with the existing
spike virtualenv if installed, then inspect any fixture change before use.
