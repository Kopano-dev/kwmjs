# Tools

YARN   ?= yarn

# Variables
DIST := ./dist
TARGET  ?= ES2015
DATE    ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION ?= $(shell git describe --tags --always --dirty --match=v* 2>/dev/null || \
			cat $(CURDIR)/.version 2> /dev/null || echo v0.0.0-unreleased)

# Build

.PHONY: all
all: vendor | kwm docs

$(DIST): ; $(info creating dist path ...) @
	mkdir $(DIST)

.PHONY: kwm
kwm: vendor | $(DIST) ; $(info building $@ ...) @
	BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --verbose

.PHONY: kwm-es5
kwm-es5: TARGET=ES5
kwm-es5: kwm

.PHONY: kwm-dev
kwm-dev: vendor | $(DIST) ; $(info building and watching $@ ...) @
	@BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --progress --verbose --color --watch

.PHONY: docs
docs: vendor | $(DIST) ; $(info building $@ ...) @
	@$(YARN) typedoc -- --out $(DIST)/docs --hideGenerator --excludePrivate --readme ./doc/USAGE.md --name 'Kopano Webmeetings Javascript Client Library $(VERSION)' --mode file --theme minimal --target ES5 ./src

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

.PHONY: clean
clean: ; $(info cleaning ...) @
	@rm -rf $(DIST)

.PHONY: version
version:
	@echo $(VERSION)
