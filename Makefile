NODE ?= node

build:
	@$(NODE) ./node_modules/browserify/bin/cmd.js ./index.js > ./webcacheddb.js

.PHONY: build