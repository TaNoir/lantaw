//! Encrypted backups: Argon2id turns a passphrase into a key, AES-256-GCM seals the data.
//! No randomness here: JS supplies the salt and nonce so no RNG crate enters the WASM build.

use crate::model::EngineError;
use aes_gcm::aead::consts::U12;
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};

/// Argon2id cost settings. Stored with the backup so old files stay readable if defaults change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    /// Memory in KiB.
    pub m_kib: u32,
    /// Number of passes.
    pub t: u32,
    /// Degree of parallelism (lanes).
    pub p: u32,
}

impl KdfParams {
    pub const DEFAULT: KdfParams = KdfParams { m_kib: 19456, t: 2, p: 1 };
}

/// Salt length in bytes (Argon2 input).
const SALT_LEN: usize = 16;
/// Nonce length in bytes (AES-GCM standard 96-bit nonce).
const NONCE_LEN: usize = 12;

fn err(msg: &str) -> EngineError {
    EngineError::Backup(msg.to_string())
}

/// Stretch the passphrase into a 32-byte AES key with Argon2id (version 0x13).
fn derive_key(passphrase: &str, salt: &[u8], kdf: &KdfParams) -> Result<[u8; 32], EngineError> {
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32)).map_err(|_| err("bad kdf params"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| err("key derivation failed"))?;
    Ok(key)
}

/// Check lengths, derive the key, and build the cipher plus nonce shared by both directions.
fn setup(
    passphrase: &str, salt: &[u8], nonce: &[u8], kdf: &KdfParams,
) -> Result<(Aes256Gcm, Nonce<U12>), EngineError> {
    if salt.len() != SALT_LEN || nonce.len() != NONCE_LEN {
        return Err(err("bad salt/nonce length"));
    }
    let key = derive_key(passphrase, salt, kdf)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| err("bad key"))?;
    let nonce = Nonce::<U12>::try_from(nonce).map_err(|_| err("bad salt/nonce length"))?;
    Ok((cipher, nonce))
}

/// Encrypt `plaintext`; the output is ciphertext followed by the 16-byte GCM tag.
pub fn encrypt(
    plaintext: &[u8], passphrase: &str, salt: &[u8], nonce: &[u8], kdf: &KdfParams,
) -> Result<Vec<u8>, EngineError> {
    let (cipher, nonce) = setup(passphrase, salt, nonce, kdf)?;
    cipher.encrypt(&nonce, plaintext).map_err(|_| err("encryption failed"))
}

/// Decrypt and authenticate. A wrong passphrase and a tampered file look the same
/// (the tag check fails), so both give the same message.
pub fn decrypt(
    ciphertext: &[u8], passphrase: &str, salt: &[u8], nonce: &[u8], kdf: &KdfParams,
) -> Result<Vec<u8>, EngineError> {
    let (cipher, nonce) = setup(passphrase, salt, nonce, kdf)?;
    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| err("wrong passphrase or damaged file"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tiny cost so tests run fast.
    const FAST: KdfParams = KdfParams { m_kib: 64, t: 1, p: 1 };
    const SALT: [u8; 16] = [7; 16];
    const NONCE: [u8; 12] = [9; 12];

    #[test]
    fn round_trip() {
        let sealed = encrypt(b"lantaw", "hunter2", &SALT, &NONCE, &FAST).unwrap();
        assert_ne!(sealed, b"lantaw");
        assert_eq!(decrypt(&sealed, "hunter2", &SALT, &NONCE, &FAST).unwrap(), b"lantaw");
    }

    #[test]
    fn wrong_passphrase_fails() {
        let sealed = encrypt(b"lantaw", "hunter2", &SALT, &NONCE, &FAST).unwrap();
        assert!(matches!(decrypt(&sealed, "wrong", &SALT, &NONCE, &FAST), Err(EngineError::Backup(_))));
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let mut sealed = encrypt(b"lantaw", "hunter2", &SALT, &NONCE, &FAST).unwrap();
        sealed[0] ^= 1;
        assert!(matches!(decrypt(&sealed, "hunter2", &SALT, &NONCE, &FAST), Err(EngineError::Backup(_))));
    }

    #[test]
    fn bad_nonce_length_fails() {
        assert_eq!(
            encrypt(b"x", "p", &SALT, &[0; 11], &FAST),
            Err(EngineError::Backup("bad salt/nonce length".into()))
        );
        assert!(matches!(decrypt(b"x", "p", &SALT, &[0; 11], &FAST), Err(EngineError::Backup(_))));
    }
}
