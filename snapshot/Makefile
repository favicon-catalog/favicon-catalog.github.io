.PHONY: add validate test release release-sample sizes

ifneq (,$(filter add,$(MAKECMDGOALS)))
ADD_ARGS := $(filter-out add,$(MAKECMDGOALS))
$(foreach goal,$(ADD_ARGS),$(eval .PHONY: $(goal)))
$(foreach goal,$(ADD_ARGS),$(eval $(goal): ; @:))
endif

add:
	@if [ -z "$(ADD_ARGS)" ]; then \
		echo "Usage: make -C snapshot add <domain>"; \
		exit 1; \
	fi
	node ./src/cli.js add-domain $(ADD_ARGS)

validate:
	node ./src/cli.js validate

test:
	node ./src/test-domain-parsing.js

release:
	node ./src/cli.js release

release-sample:
	node ./src/cli.js release-sample

sizes:
	node ./src/cli.js sizes
