//! Lantaw engine: a pure-Rust cashflow forecaster that compiles to WASM.
//! No I/O, no clock, no randomness: everything arrives as arguments from JS.

pub mod money;
pub mod model;
pub mod calendar;
pub mod schedule;
pub mod expand;
pub mod cutoffs;
pub mod project;
pub mod compare;
