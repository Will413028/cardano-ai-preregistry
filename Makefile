.PHONY: check integration dev mutations

check:
	npm run lint
	npm run build
	npm test
	npm run test:e2e

integration:
	npm run integration

dev:
	npm run dev

mutations:
	npm run test:mutations
