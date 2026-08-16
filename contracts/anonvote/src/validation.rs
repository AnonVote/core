use soroban_sdk::{Env, String};
use crate::ContractError;

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
