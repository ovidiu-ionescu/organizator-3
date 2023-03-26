//! # lib-hyper-organizator
//!
//! A set utility functions for creating web services using the [Hyper](https://hyper.rs/) library.
//!
//! ## Features
//! - Logging
//! - Metrics
//!
//! ## Optional Features
//!
//! lib-hyper-organizator supports the following optional features:
//!
//! - `postgres`: Enables the `postgres` module.
//! - `security`: Enables the `authentication` module.
//!
pub mod authentication;
mod logging;
mod metrics;
pub mod postgres;
pub mod response_utils;
pub mod server;
mod settings;
pub mod swagger;
pub mod typedef;
pub mod under_construction;
