//! AnonVote Soroban Smart Contract
//!
//! Records immutable audit events on the Stellar blockchain.
//! Complements the manageData approach with on-chain queryable state.
//!
//! # What this contract does
//! - Records ballot creation events with a ballot ID hash
//! - Records token issuance counts per ballot (no voter identity)
//! - Records vote cast counts per ballot (no vote content)
//! - Records result publication with a tally hash
//! - Allows public verification of event counts on-chain
//!
//! # Privacy guarantees
//! - No voter identifiers stored
//! - No token values stored
//! - No vote content stored
//! - Only counts and hashes — same privacy model as the off-chain system

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address — only admin can record events
    Admin,
    /// Token issued count for a ballot: ballot_id_hash → u32
    TokensIssued(String),
    /// Votes cast count for a ballot: ballot_id_hash → u32
    VotesCast(String),
    /// Result hash for a ballot: ballot_id_hash → String
    ResultHash(String),
    /// Whether a ballot has been created: ballot_id_hash → bool
    BallotExists(String),
    /// Timestamp when ballot was created: ballot_id_hash → u64
    BallotCreatedAt(String),
    /// Admin address that created the ballot: ballot_id_hash → Address
    BallotAdmin(String),
    /// Whether ballot is active (not yet finalized): ballot_id_hash → bool
    BallotIsActive(String),
    /// Master list of all ballot ID hashes
    BallotList,
}

// ── View function return types ────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct BallotMetadata {
    pub created_at: u64,
    pub admin: Address,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct BallotStats {
    pub tokens_issued: u32,
    pub votes_cast: u32,
    pub result_hash: Option<String>,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    /// Initialize the contract with an admin address.
    /// Must be called once after deployment.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Record a ballot creation event.
    /// ballot_id_hash: SHA-256 hex of the ballot UUID
    pub fn record_ballot(env: Env, caller: Address, ballot_id_hash: String) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let key = DataKey::BallotExists(ballot_id_hash.clone());
        if env.storage().persistent().has(&key) {
            panic!("ballot already recorded");
        }
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .set(&DataKey::TokensIssued(ballot_id_hash.clone()), &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::VotesCast(ballot_id_hash.clone()), &0u32);

        let now = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::BallotCreatedAt(ballot_id_hash.clone()), &now);
        env.storage()
            .persistent()
            .set(&DataKey::BallotAdmin(ballot_id_hash.clone()), &caller);
        env.storage()
            .persistent()
            .set(&DataKey::BallotIsActive(ballot_id_hash.clone()), &true);

        let mut list: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::BallotList)
            .unwrap_or(Vec::new(&env));
        list.push_back(ballot_id_hash.clone());
        env.storage().persistent().set(&DataKey::BallotList, &list);

        env.events()
            .publish((symbol_short!("ballot"),), (symbol_short!("created"),));
    }

    /// Increment the token issued count for a ballot.
    /// Called when a voter token is issued.
    pub fn record_token(env: Env, caller: Address, ballot_id_hash: String) {
        caller.require_auth();
        Self::require_admin(&env, &caller);
        Self::require_ballot_exists(&env, &ballot_id_hash);

        let key = DataKey::TokensIssued(ballot_id_hash);
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(count + 1));

        env.events()
            .publish((symbol_short!("token"),), (symbol_short!("issued"),));
    }

    /// Increment the votes cast count for a ballot.
    /// Called when a vote is submitted.
    pub fn record_vote(env: Env, caller: Address, ballot_id_hash: String) {
        caller.require_auth();
        Self::require_admin(&env, &caller);
        Self::require_ballot_exists(&env, &ballot_id_hash);

        let key = DataKey::VotesCast(ballot_id_hash);
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(count + 1));

        env.events()
            .publish((symbol_short!("vote"),), (symbol_short!("cast"),));
    }

    /// Record the result publication for a ballot.
    /// result_hash: SHA-256 hex of the tally JSON
    pub fn record_result(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        result_hash: String,
    ) {
        caller.require_auth();
        Self::require_admin(&env, &caller);
        Self::require_ballot_exists(&env, &ballot_id_hash);

        let key = DataKey::ResultHash(ballot_id_hash.clone());
        if env.storage().persistent().has(&key) {
            panic!("result already recorded");
        }
        env.storage().persistent().set(&key, &result_hash);
        env.storage()
            .persistent()
            .set(&DataKey::BallotIsActive(ballot_id_hash), &false);

        env.events()
            .publish((symbol_short!("result"),), (symbol_short!("published"),));
    }

    // ── Read-only queries ────────────────────────────────────────────────────

    /// Get the number of tokens issued for a ballot.
    pub fn get_tokens_issued(env: Env, ballot_id_hash: String) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TokensIssued(ballot_id_hash))
            .unwrap_or(0)
    }

    /// Get the number of votes cast for a ballot.
    pub fn get_votes_cast(env: Env, ballot_id_hash: String) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::VotesCast(ballot_id_hash))
            .unwrap_or(0)
    }

    /// Get the result hash for a ballot (empty string if not published).
    pub fn get_result_hash(env: Env, ballot_id_hash: String) -> Option<String> {
        env.storage()
            .persistent()
            .get(&DataKey::ResultHash(ballot_id_hash))
    }

    /// Check if a ballot has been recorded on-chain.
    pub fn ballot_exists(env: Env, ballot_id_hash: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::BallotExists(ballot_id_hash))
    }

    /// Get full ballot metadata (created_at, admin, is_active).
    /// Returns zero-value defaults if the ballot does not exist.
    pub fn get_ballot_metadata(env: Env, ballot_id_hash: String) -> BallotMetadata {
        BallotMetadata {
            created_at: env
                .storage()
                .persistent()
                .get(&DataKey::BallotCreatedAt(ballot_id_hash.clone()))
                .unwrap_or(0),
            admin: env
                .storage()
                .persistent()
                .get(&DataKey::BallotAdmin(ballot_id_hash.clone()))
                .unwrap_or(env.current_contract_address()),
            is_active: env
                .storage()
                .persistent()
                .get(&DataKey::BallotIsActive(ballot_id_hash))
                .unwrap_or(false),
        }
    }

    /// Get ballot statistics (tokens_issued, votes_cast, result_hash).
    pub fn get_ballot_stats(env: Env, ballot_id_hash: String) -> BallotStats {
        BallotStats {
            tokens_issued: env
                .storage()
                .persistent()
                .get(&DataKey::TokensIssued(ballot_id_hash.clone()))
                .unwrap_or(0),
            votes_cast: env
                .storage()
                .persistent()
                .get(&DataKey::VotesCast(ballot_id_hash.clone()))
                .unwrap_or(0),
            result_hash: env
                .storage()
                .persistent()
                .get(&DataKey::ResultHash(ballot_id_hash))
                .unwrap_or(None),
        }
    }

    /// Get the list of all ballot ID hashes recorded on-chain.
    /// Returns an empty Vec if no ballots have been recorded.
    pub fn get_all_ballots(env: Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::BallotList)
            .unwrap_or(Vec::new(&env))
    }

    /// Quick check: returns true if the ballot exists and is active.
    /// Returns false for non-existent or finalized ballots.
    pub fn ballot_is_active(env: Env, ballot_id_hash: String) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::BallotIsActive(ballot_id_hash))
            .unwrap_or(false)
    }

    /// Check if a result has been published (ballot is finalized).
    /// Returns false if the ballot does not exist or no result is published.
    pub fn is_ballot_finalized(env: Env, ballot_id_hash: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::ResultHash(ballot_id_hash))
    }

    /// Verify consistency: returns true if tokens_issued == votes_cast.
    pub fn is_consistent(env: Env, ballot_id_hash: String) -> bool {
        let tokens: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TokensIssued(ballot_id_hash.clone()))
            .unwrap_or(0);
        let votes: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::VotesCast(ballot_id_hash))
            .unwrap_or(0);
        tokens == votes
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if *caller != admin {
            panic!("unauthorized");
        }
    }

    fn require_ballot_exists(env: &Env, ballot_id_hash: &String) {
        if !env
            .storage()
            .persistent()
            .has(&DataKey::BallotExists(ballot_id_hash.clone()))
        {
            panic!("ballot not found");
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn setup() -> (Env, AnonVoteContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn test_record_ballot_and_query() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "abc123");
        client.record_ballot(&admin, &ballot_hash);
        assert!(client.ballot_exists(&ballot_hash));
        assert_eq!(client.get_tokens_issued(&ballot_hash), 0);
        assert_eq!(client.get_votes_cast(&ballot_hash), 0);
    }

    #[test]
    fn test_get_ballot_metadata() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "meta-test");
        client.record_ballot(&admin, &ballot_hash);
        let meta = client.get_ballot_metadata(&ballot_hash);
        assert!(meta.is_active);
        assert_eq!(meta.admin, admin);
        assert!(meta.created_at > 0);
    }

    #[test]
    fn test_get_ballot_metadata_nonexistent() {
        let (env, client, _admin) = setup();
        let unknown = String::from_str(&env, "does-not-exist");
        let meta = client.get_ballot_metadata(&unknown);
        assert!(!meta.is_active);
        assert_eq!(meta.created_at, 0);
    }

    #[test]
    fn test_get_ballot_stats() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "stats-test");
        client.record_ballot(&admin, &ballot_hash);
        client.record_token(&admin, &ballot_hash);
        client.record_token(&admin, &ballot_hash);
        client.record_vote(&admin, &ballot_hash);
        let stats = client.get_ballot_stats(&ballot_hash);
        assert_eq!(stats.tokens_issued, 2);
        assert_eq!(stats.votes_cast, 1);
        assert!(stats.result_hash.is_none());
    }

    #[test]
    fn test_get_ballot_stats_with_result() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "stats-result");
        client.record_ballot(&admin, &ballot_hash);
        let result = String::from_str(&env, "deadbeef");
        client.record_result(&admin, &ballot_hash, &result);
        let stats = client.get_ballot_stats(&ballot_hash);
        assert_eq!(stats.result_hash, Some(result));
    }

    #[test]
    fn test_get_all_ballots() {
        let (env, client, admin) = setup();
        let ballota = String::from_str(&env, "ballot-a");
        let ballotb = String::from_str(&env, "ballot-b");
        assert_eq!(client.get_all_ballots().len(), 0);
        client.record_ballot(&admin, &ballota);
        assert_eq!(client.get_all_ballots().len(), 1);
        client.record_ballot(&admin, &ballotb);
        let all = client.get_all_ballots();
        assert_eq!(all.len(), 2);
        assert_eq!(all.get(0).unwrap(), ballota);
        assert_eq!(all.get(1).unwrap(), ballotb);
    }

    #[test]
    fn test_ballot_is_active_and_finalized() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "active-test");
        // Non-existent
        assert!(!client.ballot_is_active(&ballot_hash));
        assert!(!client.is_ballot_finalized(&ballot_hash));
        // After creation — active, not finalized
        client.record_ballot(&admin, &ballot_hash);
        assert!(client.ballot_is_active(&ballot_hash));
        assert!(!client.is_ballot_finalized(&ballot_hash));
        // After result — not active, finalized
        let result = String::from_str(&env, "tally-hash");
        client.record_result(&admin, &ballot_hash, &result);
        assert!(!client.ballot_is_active(&ballot_hash));
        assert!(client.is_ballot_finalized(&ballot_hash));
    }

    #[test]
    fn test_view_functions_do_not_mutate_state() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "view-only");
        client.record_ballot(&admin, &ballot_hash);
        let tokens_before = client.get_tokens_issued(&ballot_hash);
        // Calling view functions should not change counts
        let _meta = client.get_ballot_metadata(&ballot_hash);
        let _stats = client.get_ballot_stats(&ballot_hash);
        let _all = client.get_all_ballots();
        let _active = client.ballot_is_active(&ballot_hash);
        let _finalized = client.is_ballot_finalized(&ballot_hash);
        assert_eq!(client.get_tokens_issued(&ballot_hash), tokens_before);
        assert_eq!(client.get_votes_cast(&ballot_hash), 0);
    }

    #[test]
    fn test_token_and_vote_counts() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "abc123");
        client.record_ballot(&admin, &ballot_hash);
        client.record_token(&admin, &ballot_hash);
        client.record_token(&admin, &ballot_hash);
        client.record_vote(&admin, &ballot_hash);
        assert_eq!(client.get_tokens_issued(&ballot_hash), 2);
        assert_eq!(client.get_votes_cast(&ballot_hash), 1);
        assert!(!client.is_consistent(&ballot_hash));
        client.record_vote(&admin, &ballot_hash);
        assert!(client.is_consistent(&ballot_hash));
    }

    #[test]
    fn test_record_result() {
        let (env, client, admin) = setup();
        let ballot_hash = String::from_str(&env, "abc123");
        let result_hash = String::from_str(&env, "deadbeef");
        client.record_ballot(&admin, &ballot_hash);
        client.record_result(&admin, &ballot_hash, &result_hash);
        assert_eq!(client.get_result_hash(&ballot_hash), Some(result_hash));
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_caller() {
        let (env, client, _admin) = setup();
        let ballot_hash = String::from_str(&env, "abc123");
        let attacker = Address::generate(&env);
        client.record_ballot(&attacker, &ballot_hash);
    }
}
