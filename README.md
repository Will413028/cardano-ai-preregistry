# Cardano AI Preregistry

Help AI, RAG and agent developers preregister experiments and compare disclosed results with their original plans.

## Status

The local TypeScript web app retains its browser-memory demo and adds Mesh/CIP-30 testnet registration and disclosure: prepare a public metadata transaction, download the private draft, sign, submit and check chain confirmation; later create a disclosure bundle with results and file hashes, host it yourself, announce its URL and hash from the registering wallet, and verify the announcement, signer, bundle and files. Browser fixtures and real-CBOR tests cover the wallet flows. Verification reads raw transaction bytes and checks them itself (transaction hash, metadata hash, the registrant's witness), with a Mithril certificate for inclusion and block time on preprod; commitment format v2 binds the registrant into the hash. Local devnet registration, announcement and independent readback are validated, and a live read-only preprod check verifies a public sample transaction through Koios and Mithril. It does not derive registry states or list registrations. No deployment or user validation exists.

The approved MVP uses transaction metadata on preprod/local devnet; complete Koios indexing follows in a later step. See [the MVP plan](docs/plans/2026-10-01-preregistry-mvp.md), [registration acceptance](docs/plans/2026-10-01-preregistry-mvp/registration.md), [disclosure acceptance](docs/plans/2026-10-01-preregistry-mvp/disclosure.md), [trust-model acceptance](docs/plans/2026-10-01-preregistry-mvp/trust.md), [commitment v2 and the verification model](docs/commitment-v2.md) and [commitment v1](docs/commitment-v1.md).

## Planned experience

1. Define a canonical experiment manifest covering datasets, model versions, settings, metrics and planned runs.
2. Commit a salted manifest hash on Cardano before execution.
3. Reveal the manifest and results, and verify the commitment while tracking registered experiment statuses.

## Scope

- Use Cardano to reduce dependence on a single operator and support independent verification.
- Payments, revenue splitting and bookings are outside the product scope.
- Token issuance, NFTs, betting and cryptocurrency prizes are not the product core.

## Verification boundaries

Commitments do not prove actual execution, truthful results, fair scoring or registration of every experiment. Original files require separate storage.

On preprod, inclusion and block time rest on Mithril: its compiled-in genesis key and an honest majority of signing stake. preprod and preview share that key, so Mithril does not tell those two testnets apart. Local devnet results are only locally trusted, and the in-tab demo is not chain evidence. "Not found" means a data source did not return a transaction; it does not prove absence.

## Development

Use Node 22.23.3 (see `.nvmrc`) and npm. From the repository root:

```sh
npm ci
npx playwright install chromium
make dev
```

Open the localhost URL printed by Vite. The demo keeps manifest and salt in
the browser; save the private draft before leaving. Fake-chain records are
cleared on reload. The dataset digest in the sample is a placeholder.

```sh
make check        # lint, TypeScript check/build, unit tests, Chromium e2e
make mutations    # tests must reject all fourteen deliberately broken behaviors
make integration  # default: live, read-only Koios + Mithril check of a public preprod transaction (about a minute); no key
PREREGISTRY_DEVNET=1 make integration  # opt-in: local magic-42 registration and announcement
```

After dependencies and Chromium are installed, `make check` and `make mutations`
need no public-chain service; Mithril tests replay recorded preprod responses, and
two of them walk the full certificate chain (about a minute each). GitHub Actions
uses the same checks. `make integration` verifies an existing public sample, not an
application commitment. The production build is static and reads Koios, the Mithril
aggregator and (for devnet) Yaci Store directly. `/api/read` and `/api/cardano` are
Vite development-only routes, not deployed APIs; `/api/cardano` is an optional,
untrusted cache that returns only whitelisted public reads and raw transaction bytes.

The independent verifiers are `verify_reveal` and `verify_announcement` in
`src/verifier.ts`; they accept an injected `ChainReader` and file fetcher and
have no dependency on the web UI or operator API. A `ChainReader` returns raw
bytes from any source plus inclusion from its trust root (`src/mithril.ts`,
`src/readers.ts`).

## License

[MIT](LICENSE).

## References

- https://help.osf.io/article/330-welcome-to-registrations
- https://www.aspredicted.org/

## Testnet registration

Use a CIP-30 browser wallet connected to the selected test network, refresh wallets,
and prepare registration. Keep the downloaded private draft before signing. The app
checks the wallet input on the selected chain, caps the fee at 300000 lovelace
(0.3 testADA), and rechecks the signed body and metadata before submission.

This slice supports one ADA-only key input of at least 3 testADA. The registrant is
the wallet's change-address payment key, chosen before the hash is computed and
declared as the transaction's required signer; the fee input may belong to another
key of the same wallet. The app refuses to submit unless the signed transaction has
a valid witness for the registrant. Mainnet, fragmented funding, multi-asset input
selection and stake-key identities are outside this slice. Preprod reads go directly
to public Koios (or through the development cache); local devnet reads require
Yaci Store at `127.0.0.1:18080` (magic 42) and use the signed transactions this tab
submitted, because Yaci Store keeps no transaction bytes.

A submitted transaction is pending until readback; on preprod it also waits for a
Mithril certificate, usually a few minutes after inclusion. Keep its saved draft and
transaction hash if signing/submission fails or confirmation is delayed. The app
never automatically resubmits an uncertain transaction. You can reopen a saved draft
and select the test-network reader to independently check the commitment.

## Disclosure

After your runs, the page builds a disclosure bundle from your private draft,
results and the files you select; file hashes are computed in the browser and
nothing is uploaded. Host the downloaded bundle and files yourself at public
https URLs. The bundle contains your manifest and salt, so hosting it discloses
the plan.

The announcement is a second testnet metadata transaction from the wallet key
that registered the commitment. It publishes only the commitment transaction
hash, the bundle hash and the bundle URL. Verification takes the bundle and
files from their URLs or from files you upload, and reports a match only when the
announcement's witnessed signer is the commitment's registrant and the bundle hash,
manifest, salt, registrant, deadline, network and every file hash agree. Hosting
servers must allow cross-origin reads for URL fetching in the browser. Results,
times and files remain the registrant's claims; matching hashes show only that
they are unchanged since the announcement.
