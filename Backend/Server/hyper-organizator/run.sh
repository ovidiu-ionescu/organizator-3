#!/usr/bin/env bash
set -e

RUST_LOG=trace cargo run
# RUST_LOG=my_crate=info cargo run --release

