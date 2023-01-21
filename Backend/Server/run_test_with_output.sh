#!/usr/bin/bash

reset; RUST_LOG=trace cargo test integration_test -- --nocapture

