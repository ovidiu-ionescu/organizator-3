#!/usr/bin/env bash
# Build the project with tokio unstable to enable tokio console

RUSTFLAGS="--cfg tokio_unstable" RUST_LOG=info cargo run --release

