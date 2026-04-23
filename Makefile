.PHONY: check dev

dev:
	npm run dev

check:
	npm run build
	$(MAKE) -C snapshot validate
	$(MAKE) -C snapshot test
	npm run check:domains-format
	node ./scripts/validate-version.js
