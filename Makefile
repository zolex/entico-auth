.PHONY: all install dev demo build release test test-frontend test-rust lint clean icons

all: build

install:
	npm install

dev:
	npm run tauri dev

# Runs the app against in-memory sample data instead of a real YubiKey - see
# docs/superpowers/specs/2026-07-25-demo-mode-design.md
demo:
	npm run tauri dev -- -- -- --demo

# Type-check + build the frontend, then build the Tauri app (debug)
build:
	npm run build
	npm run tauri build -- --debug

# Full release build (installers/bundles)
release:
	npm run build
	npm run tauri build

test: test-frontend test-rust

test-frontend:
	npm test

test-rust:
	cd src-tauri && cargo test

lint:
	cd src-tauri && cargo fmt --check && cargo clippy

clean:
	rm -rf dist
	cd src-tauri && cargo clean

# Regenerate src-tauri/icons from a source image (default: entico-auth.png).
# Drops the android/ios/64x64.png output this project doesn't ship.
icons:
	npx tauri icon $(or $(SRC),entico-auth.png)
	rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
