.PHONY: check dev

dev:
	npm run dev

check:
	npm run build
	$(MAKE) -C snapshot validate
	$(MAKE) -C snapshot test
	./scripts/validate-version.sh
