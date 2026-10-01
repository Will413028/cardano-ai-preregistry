# Cardano AI Preregistry

Help AI, RAG and agent developers preregister experiments and compare disclosed results with their original plans.

## Status

A local TypeScript web demo now registers salted manifest commitments in a browser-memory fake chain and checks disclosed drafts for match/mismatch. It includes a fixture read proxy and shared read-cache interface. It does not submit Cardano transactions, connect wallets, publish disclosures or derive the complete registry states. No deployment or user validation exists.

The approved MVP plans Mesh/CIP-30 wallet signing, transaction metadata on preprod/local devnet and Koios indexing in later steps. See [the MVP plan](docs/plans/2026-10-01-preregistry-mvp.md) for decisions and validation evidence, and [commitment v1](docs/commitment-v1.md) for the local format.

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
make mutations    # tests must reject the two deliberately broken behaviors
make integration  # optional live, read-only Koios preprod smoke; no key
```

After dependencies and Chromium are installed, `make check` and `make mutations`
need no public-chain service. GitHub Actions uses the same checks; remote CI
has not run yet. `make integration` queries an existing public sample, not an
application commitment. The production build is a static demo; `/api/read`
is currently a Vite development-only fixture route, not a deployed API.

The independent verifier is `verify_reveal` in `src/verifier.ts`; it accepts
an injected `ChainReader` and has no dependency on the web UI or operator API.

## License

[MIT](LICENSE).

## References

- https://help.osf.io/article/330-welcome-to-registrations
- https://www.aspredicted.org/
