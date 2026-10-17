# Cardano AI Preregistry

Help AI, RAG and agent developers preregister experiments and compare disclosed results with their original plans.

## Status

The local TypeScript web app retains its browser-memory demo and adds Mesh/CIP-30 testnet registration and disclosure: prepare a public metadata transaction, download the private draft, sign, submit and check chain confirmation; later create a disclosure bundle with results and file hashes, host it yourself, announce its URL and hash from the registering wallet, and verify the announcement, signer, bundle and files. Browser fixtures and real-CBOR tests cover the wallet flows. Local devnet registration, announcement and independent readback are validated; [Linux CI](https://github.com/Will413028/cardano-ai-preregistry/actions/runs/36884486573) passes the offline checks and mutations for the registration slice. It does not derive registry states or list registrations. No deployment or user validation exists.

The approved MVP uses transaction metadata on preprod/local devnet; complete Koios indexing follows in a later step. See [the MVP plan](docs/plans/2026-10-01-preregistry-mvp.md), [registration acceptance](docs/plans/2026-10-01-preregistry-mvp/registration.md), [disclosure acceptance](docs/plans/2026-10-01-preregistry-mvp/disclosure.md) and [commitment v1](docs/commitment-v1.md).

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
make mutations    # tests must reject all eight deliberately broken behaviors
make integration  # default: live, read-only Koios preprod smoke; no key
PREREGISTRY_DEVNET=1 make integration  # opt-in: local magic-42 registration and announcement
```

After dependencies and Chromium are installed, `make check` and `make mutations`
need no public-chain service. GitHub Actions uses the same checks; [the initial CI run](https://github.com/Will413028/cardano-ai-preregistry/actions/runs/36868041395)
passed on Linux with Node 22.23.3. `make integration` queries an existing public sample, not an
application commitment. The production build is static; `/api/read` and `/api/cardano`
are currently Vite development-only routes, not deployed APIs. The latter accepts
only whitelisted public reads through a shared cache and fixed provider URLs.

The independent verifiers are `verify_reveal` and `verify_announcement` in
`src/verifier.ts`; they accept an injected `ChainReader` and file fetcher and
have no dependency on the web UI or operator API.

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
that input's payment key; an HD wallet may use a different change key. Mainnet,
fragmented funding, multi-asset input selection and multiple payment identities
are outside this slice. Preprod reads use public Koios through the same-origin route;
local devnet reads require Yaci Store at `127.0.0.1:18080` (magic 42).

A submitted transaction is pending until readback. Keep its saved draft and
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
hash, the bundle hash and the bundle URL. Verification fetches the bundle and
files from their URLs and reports a match only when the announcement signer,
bundle hash, manifest, salt, deadline, network and every file hash agree.
Hosting servers must allow cross-origin reads for the browser verifier. Results,
times and files remain the registrant's claims; matching hashes show only that
they are unchanged since the announcement.
