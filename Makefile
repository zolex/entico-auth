.PHONY: all install dev build release test test-frontend test-rust lint clean

all: build

install:
	npm install

dev:
	npm run tauri dev

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
