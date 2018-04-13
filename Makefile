PACKAGE_NAME = kwmjs

# Tools

YARN   ?= yarn

# Variables
TARGET  ?= ES5
DATE    ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION ?= $(shell git describe --tags --always --dirty --match=v* 2>/dev/null | sed 's/^v//' || \
			cat $(CURDIR)/.version 2> /dev/null || echo 0.0.0-unreleased)


# Build

.PHONY: all
all: vendor | kwm docs

.PHONY: kwmjs
kwmjs: vendor ; $(info building $@ ...) @
	BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --verbose
	echo $(VERSION) > .version

.PHONY: kwm
kwm: kwmjs

.PHONY: kwm-es5
kwm-es5: TARGET=ES5
kwm-es5: kwmjs

.PHONY: kwm-es6
kwm-es6: TARGET=ES2015
kwm-es6: kwmjs

.PHONY: kwm-dev
kwm-dev: vendor ; $(info building and watching $@ ...) @
	@BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --progress --verbose --color --watch

.PHONY: docs
docs: vendor ; $(info building $@ ...) @
	@$(YARN) typedoc -- --out ./docs --hideGenerator --excludePrivate --readme ./doc/USAGE.md --name 'Kopano Webmeetings Javascript Client Library $(VERSION)' --mode file --theme minimal --target ES5 ./src

# Helpers

.PHONY: lint
lint: vendor ; $(info running linters ...) @
	@$(YARN) tslint -p .

# Yarn

.PHONY: vendor
vendor: node_modules

node_modules: ; $(info retrieving dependencies ...) @
	@$(YARN) install --silent
	@touch $@

.PHONY: dist
dist: ; $(info building dist tarball ...)
	@mkdir -p "dist/"
	$(YARN) pack --filename="dist/${PACKAGE_NAME}-${VERSION}.tgz"

.PHONY: clean
clean: ; $(info cleaning ...) @
	$(YARN) cache clean
	$(YARN) clean
	@rm -rf node_modules

.PHONY: version
version:
	@echo $(VERSION)
