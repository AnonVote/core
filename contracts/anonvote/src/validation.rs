use soroban_sdk::{BytesN, Env, String};
use crate::ContractError;

/// Validates that `hash` is a 64-character lowercase hex string (SHA-256 digest).
pub fn validate_hex_hash(
    _env: &Env,
    hash: &String,
    error: ContractError,
) -> Result<(), ContractError> {
    if hash.len() != 64 {
        return Err(error);
    }
    let mut buf = [0u8; 64];
    hash.copy_into_slice(&mut buf);
    for ch in buf.iter() {
        match ch {
            b'0'..=b'9' | b'a'..=b'f' => {}
            _ => return Err(error),
        }
    }
    Ok(())
}

/// Returns `true` if the `BytesN<32>` key is all-zero bytes (considered unset / invalid).
pub fn is_zero_admin_key(key: &BytesN<32>) -> bool {
    let arr = key.to_array();
    arr.iter().all(|&b| b == 0)
}

/// Returns `true` if two `BytesN<32>` keys are equal.
pub fn admin_keys_equal(a: &BytesN<32>, b: &BytesN<32>) -> bool {
    a == b
}
