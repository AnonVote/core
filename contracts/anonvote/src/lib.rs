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
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokensIssued(String),
    VotesCast(String),
    BallotResult(String),
    BallotExists(String),
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
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
        assert_eq!(MAX_VOTES_PER_BALLOT, 9_223_372_036_854_775_807_u64);
        assert_eq!(MAX_VOTES_PER_BALLOT, (1u64 << 63) - 1);
    }
}
