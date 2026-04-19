.PHONY: check validate-site validate-snapshot validate-version-policy

check: validate-site
	make -C snapshot validate
	make -C snapshot test
	./scripts/validate-version-policy.sh

validate-site:
	npm run build

validate-snapshot:
	make -C snapshot validate
	make -C snapshot test

validate-version-policy:
	./scripts/validate-version-policy.sh
