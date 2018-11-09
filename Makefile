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
	BUILD_VERSION=$(VERSION) BUILD_DATE=$(DATE) TARGET=$(TARGET) $(YARN) webpack --display-error-details --color --mode=production
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
	TARGET=$(TARGET) $(YARN) webpack --display-error-details --progress --color --mode=development --watch

.PHONY: docs
docs: vendor ; $(info building $@ ...) @
	@$(YARN) typedoc -- --out ./docs --hideGenerator --excludePrivate --name 'Kopano Webmeetings Javascript Client Library $(VERSION)' --mode file --theme minimal --target ES5 ./src

# Helpers

.PHONY: lint
lint: vendor ; $(info running linters ...) @
	@$(YARN) tslint -p .

.PHONY: lint-checkstyle
lint-checkstyle: vendor ; $(info running linters checkstyle ...) @
	@mkdir -p ./test
	@$(YARN) tslint -t checkstyle -p . -o ./test/tests.tslint.xml --force

# Yarn

.PHONY: vendor
vendor: .yarninstall

.yarninstall: package.json ; $(info getting depdencies with yarn ...)   @
	@$(YARN) install
	@touch $@

.PHONY: dist
dist: ; $(info building dist tarball ...)
	@mkdir -p "dist/"
	$(YARN) pack --filename="dist/${PACKAGE_NAME}-${VERSION}.tgz"

.PHONY: clean
clean: ; $(info cleaning ...) @
	$(YARN) cache clean
	@rm -rf umd
	@rm -f NOTICES.txt
	@rm -f .version
	@rm -rf node_modules
	@rm -f .yarninstall

.PHONY: version
version:
	@echo $(VERSION)
