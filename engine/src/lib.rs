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
pub mod backup;

// ---- JS-facing API (wasm-bindgen) -------------------------------------------------

use model::{EngineError, Input};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Turn an engine error into a JS `Error` whose message starts with a stable code.
fn js_err(e: EngineError) -> JsError {
    JsError::new(&e.js_message())
}

/// Turn a malformed JS argument into a JS `Error`.
fn bad_arg(e: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&format!("BAD_INPUT:{e}"))
}

/// Serialize for JS. `json_compatible` makes i64 a plain JS number (not BigInt)
/// and maps become plain objects.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(bad_arg)
}

/// `project(input) -> Projection`
#[wasm_bindgen(js_name = project)]
pub fn project_js(input: JsValue) -> Result<JsValue, JsError> {
    let input: Input = serde_wasm_bindgen::from_value(input).map_err(bad_arg)?;
    to_js(&project::project(&input).map_err(js_err)?)
}

/// `comparePurchase(input, purchase) -> Comparison`
#[wasm_bindgen(js_name = comparePurchase)]
pub fn compare_purchase_js(input: JsValue, purchase: JsValue) -> Result<JsValue, JsError> {
    let input: Input = serde_wasm_bindgen::from_value(input).map_err(bad_arg)?;
    let purchase: compare::Purchase = serde_wasm_bindgen::from_value(purchase).map_err(bad_arg)?;
    to_js(&compare::compare_purchase(&input, &purchase).map_err(js_err)?)
}

/// `encryptBackup(plaintext, passphrase, salt, nonce, mKib, t, p) -> Uint8Array`
#[wasm_bindgen(js_name = encryptBackup)]
pub fn encrypt_backup_js(
    plaintext: &[u8], passphrase: &str, salt: &[u8], nonce: &[u8], m_kib: u32, t: u32, p: u32,
) -> Result<Vec<u8>, JsError> {
    backup::encrypt(plaintext, passphrase, salt, nonce, &backup::KdfParams { m_kib, t, p }).map_err(js_err)
}

/// `decryptBackup(ciphertext, passphrase, salt, nonce, mKib, t, p) -> Uint8Array`
#[wasm_bindgen(js_name = decryptBackup)]
pub fn decrypt_backup_js(
    ciphertext: &[u8], passphrase: &str, salt: &[u8], nonce: &[u8], m_kib: u32, t: u32, p: u32,
) -> Result<Vec<u8>, JsError> {
    backup::decrypt(ciphertext, passphrase, salt, nonce, &backup::KdfParams { m_kib, t, p }).map_err(js_err)
}
