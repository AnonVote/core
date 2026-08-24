#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Env, String,
};

/// Maximum votes allowed per ballot (2^63 - 1).
/// Defensive limit to prevent 64-bit integer overflow.
pub const MAX_VOTES_PER_BALLOT: u64 = (1u64 << 63) - 1; // 9_223_372_036_854_775_807

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Returned when a ballot vote counter would exceed MAX_VOTES_PER_BALLOT (2^63 - 1).
    CounterOverflow = 1,
    /// Returned when an operation is performed on an invalid or uninitialized ballot.
    BallotNotFound = 2,
    /// Returned when an operation is performed by an unauthorized caller.
    Unauthorized = 3,
    /// Returned when a public key is invalid or identical to current key.
    InvalidKey = 4,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    AdminKey,
    TokensIssued(String),
    VotesCast(String),
    BallotResult(String),
    BallotExists(String),
}

fn is_valid_stellar_key(key: &String) -> bool {
    if key.len() != 56 {
        return false;
    }
    let mut buf = [0u8; 56];
    key.copy_into_slice(&mut buf);
    if buf[0] != b'G' {
        return false;
    }
    for &b in buf.iter() {
        let is_base32 = (b >= b'A' && b <= b'Z') || (b >= b'2' && b <= b'7');
        if !is_base32 {
            return false;
        }
    }
    true
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    /// Initialize the contract with an admin key.
    pub fn initialize(env: Env, admin_key: String) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::AdminKey) {
            return Err(Error::Unauthorized);
        }
        if !is_valid_stellar_key(&admin_key) {
            return Err(Error::InvalidKey);
        }
        env.storage().instance().set(&DataKey::AdminKey, &admin_key);
        Ok(())
    }

    /// Get current admin key.
    pub fn get_admin_key(env: Env) -> Result<String, Error> {
        env.storage()
            .instance()
            .get(&DataKey::AdminKey)
            .ok_or(Error::Unauthorized)
    }

    /// Rotate admin key. Caller must be current admin.
    pub fn rotate_admin_key(
        env: Env,
        caller: String,
        new_admin_key: String,
    ) -> Result<(), Error> {
        let current_admin: String = env
            .storage()
            .instance()
            .get(&DataKey::AdminKey)
            .ok_or(Error::Unauthorized)?;

        if caller != current_admin {
            return Err(Error::Unauthorized);
        }

        if !is_valid_stellar_key(&new_admin_key) {
            return Err(Error::InvalidKey);
        }

        if new_admin_key == current_admin {
            return Err(Error::InvalidKey);
        }

        env.storage()
            .instance()
            .set(&DataKey::AdminKey, &new_admin_key);

        env.events().publish(
            (symbol_short!("admin"), symbol_short!("rotated")),
            (current_admin, new_admin_key),
        );

        Ok(())
    }

    /// Record a ballot creation on-chain.
    pub fn record_ballot(env: Env, ballot_id_hash: String) {
        let key = DataKey::BallotExists(ballot_id_hash.clone());
        env.storage().instance().set(&key, &true);

        env.events().publish(
            (symbol_short!("ballot"), symbol_short!("created")),
            ballot_id_hash,
        );
    }

    /// Record a token issuance on-chain.
    pub fn record_token(env: Env, ballot_id_hash: String) {
        let key = DataKey::TokensIssued(ballot_id_hash.clone());
        let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
        let next = current.saturating_add(1);
        env.storage().instance().set(&key, &next);

        env.events().publish(
            (symbol_short!("token"), symbol_short!("issued")),
            ballot_id_hash,
        );
    }

    /// Record a vote cast on-chain.
    /// Rejects votes with `Error::CounterOverflow` if the vote count has reached `MAX_VOTES_PER_BALLOT`.
    pub fn record_vote(env: Env, ballot_id_hash: String) -> Result<(), Error> {
        let key = DataKey::VotesCast(ballot_id_hash.clone());
        let current: u64 = env.storage().instance().get(&key).unwrap_or(0);

        if current >= MAX_VOTES_PER_BALLOT {
            env.events().publish(
                (symbol_short!("vote"), symbol_short!("overflw")),
                ballot_id_hash.clone(),
            );
            return Err(Error::CounterOverflow);
        }

        let next = current + 1;
        env.storage().instance().set(&key, &next);

        if next >= MAX_VOTES_PER_BALLOT {
            env.events().publish(
                (symbol_short!("vote"), symbol_short!("limit")),
                ballot_id_hash.clone(),
            );
        }

        env.events().publish(
            (symbol_short!("vote"), symbol_short!("cast")),
            ballot_id_hash,
        );

        Ok(())
    }

    /// Record a result publication on-chain.
    pub fn record_result(env: Env, ballot_id_hash: String, result_hash: String) {
        let key = DataKey::BallotResult(ballot_id_hash.clone());
        env.storage().instance().set(&key, &result_hash);

        env.events().publish(
            (symbol_short!("result"), symbol_short!("publshd")),
            (ballot_id_hash, result_hash),
        );
    }

    /// Get total tokens issued for a ballot.
    pub fn get_tokens_issued(env: Env, ballot_id_hash: String) -> u64 {
        let key = DataKey::TokensIssued(ballot_id_hash);
        env.storage().instance().get(&key).unwrap_or(0)
    }

    /// Get total votes cast for a ballot.
    pub fn get_votes_cast(env: Env, ballot_id_hash: String) -> u64 {
        let key = DataKey::VotesCast(ballot_id_hash);
        env.storage().instance().get(&key).unwrap_or(0)
    }

    /// Check if audit counters are consistent (tokens_issued >= votes_cast).
    pub fn is_consistent(env: Env, ballot_id_hash: String) -> bool {
        let tokens = Self::get_tokens_issued(env.clone(), ballot_id_hash.clone());
        let votes = Self::get_votes_cast(env, ballot_id_hash);
        tokens >= votes
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    const ADMIN_1: &str = "GBRPYHAKBDZEDB6G3TTV5RFLIZSFU6L66V4H76PXD2BA42C67S5ACFF4";
    const ADMIN_2: &str = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHGSYX43W2ZQC7BAECBQ2W2EF";
    const ADMIN_3: &str = "GDUKMGUGTX2JCHQJCTQAK6P5EEAL7S3PQC2IKN5J3KAE4H7E2W5KCW4A";
    const NON_ADMIN: &str = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA64PXZAH25H";

    #[test]
    fn test_admin_can_rotate_key() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let admin1 = String::from_str(&env, ADMIN_1);
        let admin2 = String::from_str(&env, ADMIN_2);

        // Initialize
        assert!(client.try_initialize(&admin1).is_ok());
        assert_eq!(client.get_admin_key(), admin1);

        // Admin rotates key
        client.rotate_admin_key(&admin1, &admin2);

        // Verify key rotation succeeded and new key stored
        assert_eq!(client.get_admin_key(), admin2);
    }

    #[test]
    fn test_non_admin_cannot_rotate_key() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let admin1 = String::from_str(&env, ADMIN_1);
        let admin2 = String::from_str(&env, ADMIN_2);
        let non_admin = String::from_str(&env, NON_ADMIN);

        client.initialize(&admin1);

        // Non-admin attempt rejected with Unauthorized
        let res = client.try_rotate_admin_key(&non_admin, &admin2);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), Ok(Error::Unauthorized));

        // Admin key unchanged
        assert_eq!(client.get_admin_key(), admin1);
    }

    #[test]
    fn test_invalid_key_format_rejected() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let admin1 = String::from_str(&env, ADMIN_1);
        let invalid_key = String::from_str(&env, "INVALID_KEY_FORMAT");

        client.initialize(&admin1);

        // Invalid key rejected
        let res = client.try_rotate_admin_key(&admin1, &invalid_key);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), Ok(Error::InvalidKey));

        // Initializing with invalid key also fails
        let env2 = Env::default();
        let contract_id2 = env2.register(AnonVoteContract, ());
        let client2 = AnonVoteContractClient::new(&env2, &contract_id2);
        let invalid_key2 = String::from_str(&env2, "INVALID_KEY_FORMAT");
        let res_init = client2.try_initialize(&invalid_key2);
        assert_eq!(res_init.unwrap_err(), Ok(Error::InvalidKey));
    }

    #[test]
    fn test_same_key_twice_rejected() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let admin1 = String::from_str(&env, ADMIN_1);

        client.initialize(&admin1);

        // Same key rejected with InvalidKey
        let res = client.try_rotate_admin_key(&admin1, &admin1);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), Ok(Error::InvalidKey));
    }

    #[test]
    fn test_old_key_no_longer_works() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let admin1 = String::from_str(&env, ADMIN_1);
        let admin2 = String::from_str(&env, ADMIN_2);
        let admin3 = String::from_str(&env, ADMIN_3);

        client.initialize(&admin1);
        assert!(client.try_rotate_admin_key(&admin1, &admin2).is_ok());

        // Old key (admin1) tries to rotate key again -> Unauthorized
        let res_old = client.try_rotate_admin_key(&admin1, &admin3);
        assert!(res_old.is_err());
        assert_eq!(res_old.unwrap_err(), Ok(Error::Unauthorized));

        // New key (admin2) rotates to admin3 -> Succeeds
        let res_new = client.try_rotate_admin_key(&admin2, &admin3);
        assert!(res_new.is_ok());
        assert_eq!(client.get_admin_key(), admin3);
    }

    #[test]
    fn test_vote_counter_increments_correctly() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let ballot_id = String::from_str(&env, "ballot-123");

        client.record_ballot(&ballot_id);
        client.record_token(&ballot_id);

        assert_eq!(client.get_votes_cast(&ballot_id), 0);

        let res = client.try_record_vote(&ballot_id);
        assert!(res.is_ok());
        assert_eq!(client.get_votes_cast(&ballot_id), 1);

        let res2 = client.try_record_vote(&ballot_id);
        assert!(res2.is_ok());
        assert_eq!(client.get_votes_cast(&ballot_id), 2);
    }

    #[test]
    fn test_votes_at_limit_accepted() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let ballot_id = String::from_str(&env, "ballot-at-limit");

        env.as_contract(&contract_id, || {
            let key = DataKey::VotesCast(ballot_id.clone());
            env.storage().instance().set(&key, &(MAX_VOTES_PER_BALLOT - 1));
        });

        let res = client.try_record_vote(&ballot_id);
        assert!(res.is_ok());

        assert_eq!(client.get_votes_cast(&ballot_id), MAX_VOTES_PER_BALLOT);
    }

    #[test]
    fn test_vote_beyond_limit_rejected_with_counter_overflow() {
        let env = Env::default();
        let contract_id = env.register(AnonVoteContract, ());
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let ballot_id = String::from_str(&env, "ballot-overflow");

        env.as_contract(&contract_id, || {
            let key = DataKey::VotesCast(ballot_id.clone());
            env.storage().instance().set(&key, &MAX_VOTES_PER_BALLOT);
        });

        let res = client.try_record_vote(&ballot_id);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), Ok(Error::CounterOverflow));

        assert_eq!(client.get_votes_cast(&ballot_id), MAX_VOTES_PER_BALLOT);
    }

    #[test]
    fn test_error_code_descriptive() {
        assert_eq!(Error::CounterOverflow as u32, 1);
        assert_eq!(Error::BallotNotFound as u32, 2);
        assert_eq!(Error::Unauthorized as u32, 3);
        assert_eq!(Error::InvalidKey as u32, 4);
        assert_eq!(MAX_VOTES_PER_BALLOT, 9_223_372_036_854_775_807_u64);
        assert_eq!(MAX_VOTES_PER_BALLOT, (1u64 << 63) - 1);
    }
}
