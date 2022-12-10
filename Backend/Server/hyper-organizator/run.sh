#!/usr/bin/env bash
set -e
set -x

reset

LEVEL=trace
LEVEL=debug
RUST_LOG=$LEVEL cargo run
# RUST_LOG=my_crate=info cargo run --release

