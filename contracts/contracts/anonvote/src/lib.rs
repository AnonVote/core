//! AnonVote Soroban smart contract.
//!
//! The contract stores public ballot audit data and protects critical
//! governance operations with configurable M-of-N approval.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    String, Symbol, Vec,
};

const APPROVAL_EXPIRATION_SECONDS: u64 = 7 * 24 * 60 * 60;
const UPGRADE_TIME_LOCK_SECONDS: u64 = 48 * 60 * 60;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AdminUnauthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    BallotNotFound = 4,
    BallotAlreadyExists = 5,
    ResultAlreadyPublished = 6,
    CounterOverflow = 7,
    InvalidBallotHash = 8,
    UpgradeAlreadyScheduled = 9,
    NoUpgradeScheduled = 10,
    TimeLockNotExpired = 11,
    BallotExpired = 12,
    ContractPaused = 13,
    LimitExceeded = 14,
    InvalidApprovalConfig = 15,
    DuplicateApprover = 16,
    ApproverUnauthorized = 17,
    OperationNotFound = 18,
    OperationAlreadyApproved = 19,
    OperationNotPending = 20,
    OperationExpired = 21,
    SameAdmin = 22,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BallotState {
    Active,
    ResultPublished,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BallotLimits {
    pub max_tokens: u32,
    pub max_votes: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerkleProof {
    pub vote_hash: BytesN<32>,
    pub path: Vec<BytesN<32>>,
    pub index: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BallotMetadata {
    pub admin: Address,
    pub created_at: u64,
    pub expiration_time: u64,
    pub limits: BallotLimits,
    pub state: BallotState,
    pub state_updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BallotStateSnapshot {
    pub admin: Address,
    pub created_at: u64,
    pub expiration_time: u64,
    pub limits: BallotLimits,
    pub result_hash: Option<String>,
    pub state: BallotState,
    pub state_updated_at: u64,
    pub tokens_issued: u32,
    pub votes_cast: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BallotAuditReport {
    pub admin: Address,
    pub created_at: u64,
    pub expiration_time: u64,
    pub is_consistent: bool,
    pub result_hash: Option<String>,
    pub state: BallotState,
    pub tokens_issued: u32,
    pub votes_cast: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub executable_at: u64,
    pub new_wasm_hash: BytesN<32>,
    pub scheduled_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RotationRecord {
    pub old_admin: Address,
    pub new_admin: Address,
    pub rotated_at: u64,
}

/// Operations that must be approved by the configured M-of-N approvers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CriticalOperation {
    AdminRotation(Address),
    Pause,
    ResultPublication(String, String),
    UpgradeScheduling(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationStatus {
    Pending,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingOperation {
    pub approval_count: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub id: u64,
    pub operation: CriticalOperation,
    pub proposer: Address,
    pub status: OperationStatus,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    InitializedAt,
    IsPaused,
    Approvers,
    ApprovalThreshold,
    OperationNonce,
    Operation(u64),
    Approval(u64, Address),
    OperationApprover(u64, Address),
    TokensIssued(String),
    VotesCast(String),
    ResultHash(String),
    BallotMetadata(String),
    BallotExpired(String),
    PendingUpgrade,
    RotationHistory,
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    /// Initializes the contract. Governance starts as 1-of-1 with the admin as
    /// the sole approver, so deployments can explicitly configure M-of-N next.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        let mut approvers = Vec::new(&env);
        approvers.push_back(admin.clone());
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::InitializedAt, &env.ledger().timestamp());
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage()
            .instance()
            .set(&DataKey::Approvers, &approvers);
        env.storage()
            .instance()
            .set(&DataKey::ApprovalThreshold, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::OperationNonce, &0u64);
        Ok(())
    }

    /// Replaces the approver set and configures the M-of-N threshold.
    ///
    /// `n` must equal `approvers.len()`, all addresses must be unique, and
    /// `1 <= m <= n`.
    pub fn configure_approval_threshold(
        env: Env,
        caller: Address,
        approvers: Vec<Address>,
        m: u32,
        n: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        if n == 0 || m == 0 || m > n || approvers.len() != n {
            return Err(ContractError::InvalidApprovalConfig);
        }

        let mut seen = Vec::new(&env);
        for approver in approvers.iter() {
            if Self::contains_address(&seen, &approver) {
                return Err(ContractError::DuplicateApprover);
            }
            seen.push_back(approver);
        }

        env.storage()
            .instance()
            .set(&DataKey::Approvers, &approvers);
        env.storage()
            .instance()
            .set(&DataKey::ApprovalThreshold, &m);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("cfg_appr")),
            (caller, m, n),
        );
        Ok(())
    }

    /// Creates a pending critical operation. The operation remains pending
    /// until M distinct configured approvers approve it.
    pub fn create_operation(
        env: Env,
        caller: Address,
        operation: CriticalOperation,
    ) -> Result<u64, ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::validate_operation(&env, &operation)?;

        let operation_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OperationNonce)
            .unwrap_or(0);
        let next_id = operation_id
            .checked_add(1)
            .ok_or(ContractError::CounterOverflow)?;
        let created_at = env.ledger().timestamp();
        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ApprovalThreshold)
            .ok_or(ContractError::NotInitialized)?;
        let pending = PendingOperation {
            approval_count: 0,
            created_at,
            expires_at: created_at + APPROVAL_EXPIRATION_SECONDS,
            id: operation_id,
            operation,
            proposer: caller.clone(),
            status: OperationStatus::Pending,
            threshold,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Operation(operation_id), &pending);
        for approver in approvers.iter() {
            env.storage()
                .persistent()
                .set(&DataKey::OperationApprover(operation_id, approver), &true);
        }
        env.storage()
            .instance()
            .set(&DataKey::OperationNonce, &next_id);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("op_create")),
            (operation_id, caller, created_at, pending.expires_at),
        );
        Ok(operation_id)
    }

    /// Proposes result publication for M-of-N approval.
    pub fn record_result(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        result_hash: String,
    ) -> Result<u64, ContractError> {
        Self::create_operation(
            env,
            caller,
            CriticalOperation::ResultPublication(ballot_id_hash, result_hash),
        )
    }

    /// Proposes admin rotation for M-of-N approval.
    pub fn rotate_admin(
        env: Env,
        caller: Address,
        new_admin: Address,
    ) -> Result<u64, ContractError> {
        Self::create_operation(env, caller, CriticalOperation::AdminRotation(new_admin))
    }

    /// Proposes pausing the contract for M-of-N approval.
    pub fn pause_contract(env: Env, caller: Address) -> Result<u64, ContractError> {
        Self::create_operation(env, caller, CriticalOperation::Pause)
    }

    /// Proposes scheduling a time-locked upgrade for M-of-N approval.
    pub fn schedule_upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<u64, ContractError> {
        Self::create_operation(
            env,
            caller,
            CriticalOperation::UpgradeScheduling(new_wasm_hash),
        )
    }

    /// Records one approval. The approval that reaches M executes the operation
    /// in the same transaction.
    pub fn approve_operation(
        env: Env,
        operation_id: u64,
        approver_address: Address,
    ) -> Result<bool, ContractError> {
        approver_address.require_auth();
        Self::verify_initialized(&env)?;

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;
        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }
        if env.ledger().timestamp() > pending.expires_at {
            return Err(ContractError::OperationExpired);
        }
        if !env.storage().persistent().has(&DataKey::OperationApprover(
            operation_id,
            approver_address.clone(),
        )) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let approval_key = DataKey::Approval(operation_id, approver_address.clone());
        if env.storage().persistent().has(&approval_key) {
            return Err(ContractError::OperationAlreadyApproved);
        }

        pending.approval_count = pending
            .approval_count
            .checked_add(1)
            .ok_or(ContractError::CounterOverflow)?;
        env.storage().persistent().set(&approval_key, &true);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("approved")),
            (
                operation_id,
                approver_address,
                pending.approval_count,
                env.ledger().timestamp(),
            ),
        );

        if pending.approval_count < pending.threshold {
            env.storage().persistent().set(&key, &pending);
            return Ok(false);
        }

        Self::execute_operation(&env, &pending.operation)?;
        pending.status = OperationStatus::Executed;
        env.storage().persistent().set(&key, &pending);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("op_exec")),
            (
                operation_id,
                pending.approval_count,
                env.ledger().timestamp(),
            ),
        );
        Ok(true)
    }

    /// Cancels a pending operation before it reaches its approval threshold.
    pub fn cancel_operation(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;
        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }

        pending.status = OperationStatus::Cancelled;
        env.storage().persistent().set(&key, &pending);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("op_cancel")),
            (operation_id, caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Records multiple ballots atomically.
    ///
    /// All ballots are validated first; if any ballot is invalid the entire
    /// batch is rejected and no state is written.  On success, returns a
    /// `Vec<String>` containing the ballot_id_hash of every recorded ballot,
    /// in the same order they were supplied.
    pub fn record_ballots_batch(
        env: Env,
        caller: Address,
        ballots: Vec<(String, BallotLimits)>,
    ) -> Result<Vec<String>, ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        // ── Phase 1: validate everything before writing anything ──────────
        for i in 0..ballots.len() {
            let (ballot_id_hash, _) = ballots.get(i).unwrap();
            if ballot_id_hash.is_empty() {
                return Err(ContractError::InvalidBallotHash);
            }
            let key = DataKey::BallotMetadata(ballot_id_hash.clone());
            if env.storage().persistent().has(&key) {
                return Err(ContractError::BallotAlreadyExists);
            }
        }

        // ── Phase 2: write all ballots ────────────────────────────────────
        let now = env.ledger().timestamp();
        let mut recorded: Vec<String> = Vec::new(&env);

        for i in 0..ballots.len() {
            let (ballot_id_hash, limits) = ballots.get(i).unwrap();
            let key = DataKey::BallotMetadata(ballot_id_hash.clone());
            let metadata = BallotMetadata {
                admin: caller.clone(),
                created_at: now,
                expiration_time: 0,
                limits,
                state: BallotState::Active,
                state_updated_at: now,
            };
            env.storage().persistent().set(&key, &metadata);
            env.storage()
                .persistent()
                .set(&DataKey::TokensIssued(ballot_id_hash.clone()), &0u32);
            env.storage()
                .persistent()
                .set(&DataKey::VotesCast(ballot_id_hash.clone()), &0u32);
            env.events().publish(
                (symbol_short!("audit"), symbol_short!("blt_crtd")),
                (ballot_id_hash.clone(), now, caller.clone()),
            );
            recorded.push_back(ballot_id_hash);
        }

        Ok(recorded)
    }

    pub fn record_ballot(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        limits: BallotLimits,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        if ballot_id_hash.is_empty() {
            return Err(ContractError::InvalidBallotHash);
        }

        let key = DataKey::BallotMetadata(ballot_id_hash.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::BallotAlreadyExists);
        }

        let now = env.ledger().timestamp();
        let metadata = BallotMetadata {
            admin: caller.clone(),
            created_at: now,
            expiration_time: 0,
            limits,
            state: BallotState::Active,
            state_updated_at: now,
        };
        env.storage().persistent().set(&key, &metadata);
        env.storage()
            .persistent()
            .set(&DataKey::TokensIssued(ballot_id_hash.clone()), &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::VotesCast(ballot_id_hash.clone()), &0u32);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("blt_crtd")),
            (ballot_id_hash, now, caller),
        );
        Ok(())
    }

    pub fn record_token(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;
        Self::require_ballot_not_expired(&env, &ballot_id_hash)?;

        let key = DataKey::TokensIssued(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        if count >= metadata.limits.max_tokens {
            return Err(ContractError::LimitExceeded);
        }
        let new_count = count.checked_add(1).ok_or(ContractError::CounterOverflow)?;
        env.storage().persistent().set(&key, &new_count);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("tok_issd")),
            (ballot_id_hash, new_count),
        );
        Ok(())
    }

    pub fn record_vote(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;
        Self::require_ballot_not_expired(&env, &ballot_id_hash)?;

        let key = DataKey::VotesCast(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        if count >= metadata.limits.max_votes {
            return Err(ContractError::LimitExceeded);
        }
        let new_count = count.checked_add(1).ok_or(ContractError::CounterOverflow)?;
        env.storage().persistent().set(&key, &new_count);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("vote_cast")),
            (ballot_id_hash, new_count),
        );
        Ok(())
    }

    pub fn expire_ballot(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::require_ballot_metadata(&env, &ballot_id_hash)?;
        env.storage()
            .persistent()
            .set(&DataKey::BallotExpired(ballot_id_hash.clone()), &true);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("exp_adm")),
            ballot_id_hash,
        );
        Ok(())
    }

    pub fn cancel_upgrade(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        if !env.storage().instance().has(&DataKey::PendingUpgrade) {
            return Err(ContractError::NoUpgradeScheduled);
        }
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("upg_cncl")),
            (caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    pub fn execute_upgrade(env: Env) -> Result<(), ContractError> {
        Self::verify_initialized(&env)?;
        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .ok_or(ContractError::NoUpgradeScheduled)?;
        if env.ledger().timestamp() < pending.executable_at {
            return Err(ContractError::TimeLockNotExpired);
        }
        env.deployer()
            .update_current_contract_wasm(pending.new_wasm_hash.clone());
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("upg_excd")),
            pending.new_wasm_hash,
        );
        Ok(())
    }

    pub fn resume_contract(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("resumed")),
            (caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    pub fn get_approvers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Approvers)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_approval_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ApprovalThreshold)
            .unwrap_or(0)
    }

    pub fn get_operation(env: Env, operation_id: u64) -> Option<PendingOperation> {
        env.storage()
            .persistent()
            .get(&DataKey::Operation(operation_id))
    }

    pub fn has_approved(env: Env, operation_id: u64, approver: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Approval(operation_id, approver))
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn get_pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        env.storage().instance().get(&DataKey::PendingUpgrade)
    }

    pub fn get_rotation_history(env: Env) -> Vec<RotationRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::RotationHistory)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_tokens_issued(env: Env, ballot_id_hash: String) -> Option<u32> {
        if !Self::ballot_exists(env.clone(), ballot_id_hash.clone()) {
            return None;
        }
        env.storage()
            .persistent()
            .get(&DataKey::TokensIssued(ballot_id_hash))
    }

    pub fn get_votes_cast(env: Env, ballot_id_hash: String) -> Option<u32> {
        if !Self::ballot_exists(env.clone(), ballot_id_hash.clone()) {
            return None;
        }
        env.storage()
            .persistent()
            .get(&DataKey::VotesCast(ballot_id_hash))
    }

    pub fn get_result_hash(env: Env, ballot_id_hash: String) -> Option<String> {
        env.storage()
            .persistent()
            .get(&DataKey::ResultHash(ballot_id_hash))
    }

    pub fn ballot_exists(env: Env, ballot_id_hash: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::BallotMetadata(ballot_id_hash))
    }

    pub fn result_exists(env: Env, ballot_id_hash: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::ResultHash(ballot_id_hash))
    }

    pub fn get_initialized_at(env: Env) -> Option<u64> {
        env.storage().instance().get(&DataKey::InitializedAt)
    }

    pub fn get_ballot_metadata(env: Env, ballot_id_hash: String) -> Option<BallotMetadata> {
        env.storage()
            .persistent()
            .get(&DataKey::BallotMetadata(ballot_id_hash))
    }

    /// Returns the ledger timestamp captured when the ballot was first recorded.
    /// Returns None if the ballot does not exist.
    /// The value is immutable — it is set once in record_ballot and never updated.
    pub fn get_ballot_created_at(env: Env, ballot_id_hash: String) -> Option<u64> {
        let metadata: BallotMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::BallotMetadata(ballot_id_hash))?;
        Some(metadata.created_at)
    }

    pub fn get_ballot_state(env: Env, ballot_id_hash: String) -> Option<BallotStateSnapshot> {
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash).ok()?;
        Some(BallotStateSnapshot {
            admin: metadata.admin,
            created_at: metadata.created_at,
            expiration_time: metadata.expiration_time,
            limits: metadata.limits,
            result_hash: env
                .storage()
                .persistent()
                .get(&DataKey::ResultHash(ballot_id_hash.clone())),
            state: metadata.state,
            state_updated_at: metadata.state_updated_at,
            tokens_issued: env
                .storage()
                .persistent()
                .get(&DataKey::TokensIssued(ballot_id_hash.clone()))
                .unwrap_or(0),
            votes_cast: env
                .storage()
                .persistent()
                .get(&DataKey::VotesCast(ballot_id_hash))
                .unwrap_or(0),
        })
    }

    pub fn get_audit_report(env: Env, ballot_id_hash: String) -> Option<BallotAuditReport> {
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash).ok()?;
        let tokens: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TokensIssued(ballot_id_hash.clone()))
            .unwrap_or(0);
        let votes: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::VotesCast(ballot_id_hash.clone()))
            .unwrap_or(0);
        let result_hash = env
            .storage()
            .persistent()
            .get(&DataKey::ResultHash(ballot_id_hash));
        Some(BallotAuditReport {
            admin: metadata.admin,
            created_at: metadata.created_at,
            expiration_time: metadata.expiration_time,
            is_consistent: tokens == votes,
            result_hash,
            state: metadata.state,
            tokens_issued: tokens,
            votes_cast: votes,
        })
    }

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

    /// Verifies a Merkle proof of a vote against the published result hash.
    pub fn verify_result_proof(
        env: Env,
        ballot_id_hash: String,
        vote_merkle_proof: MerkleProof,
        result_hash: String,
    ) -> Result<bool, ContractError> {
        let result_key = DataKey::ResultHash(ballot_id_hash.clone());
        if !env.storage().persistent().has(&result_key) {
            return Err(ContractError::BallotNotFound);
        }
        let stored_result_hash: String = env.storage().persistent().get(&result_key).unwrap();

        let mut current_hash = vote_merkle_proof.vote_hash.clone();
        let mut idx = vote_merkle_proof.index;

        for sibling in vote_merkle_proof.path.iter() {
            let mut data = Bytes::new(&env);
            if idx % 2 == 0 {
                data.extend_from_array(&current_hash.to_array());
                data.extend_from_array(&sibling.to_array());
            } else {
                data.extend_from_array(&sibling.to_array());
                data.extend_from_array(&current_hash.to_array());
            }
            current_hash = env.crypto().sha256(&data).into();
            idx /= 2;
        }

        let computed_root_hex = bytes_to_hex(&env, &current_hash);

        if computed_root_hex != result_hash {
            return Ok(false);
        }
        if stored_result_hash != result_hash {
            return Ok(false);
        }

        Ok(true)
    }

    fn validate_operation(env: &Env, operation: &CriticalOperation) -> Result<(), ContractError> {
        match operation {
            CriticalOperation::ResultPublication(ballot_id_hash, result_hash) => {
                Self::require_ballot_metadata(env, ballot_id_hash)?;
                if result_hash.is_empty() {
                    return Err(ContractError::InvalidBallotHash);
                }
                if let Some(existing) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, String>(&DataKey::ResultHash(ballot_id_hash.clone()))
                {
                    if existing != *result_hash {
                        return Err(ContractError::ResultAlreadyPublished);
                    }
                }
            }
            CriticalOperation::UpgradeScheduling(_) => {
                if env.storage().instance().has(&DataKey::PendingUpgrade) {
                    return Err(ContractError::UpgradeAlreadyScheduled);
                }
            }
            CriticalOperation::AdminRotation(new_admin) => {
                let current_admin: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(ContractError::NotInitialized)?;
                if current_admin == *new_admin {
                    return Err(ContractError::SameAdmin);
                }
            }
            CriticalOperation::Pause => {}
        }
        Ok(())
    }

    fn execute_operation(env: &Env, operation: &CriticalOperation) -> Result<(), ContractError> {
        match operation {
            CriticalOperation::AdminRotation(new_admin) => {
                let old_admin: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(ContractError::NotInitialized)?;
                if old_admin == *new_admin {
                    return Err(ContractError::SameAdmin);
                }
                let rotated_at = env.ledger().timestamp();
                env.storage().instance().set(&DataKey::Admin, new_admin);

                // Append to rotation history stored in persistent storage.
                let mut history: Vec<RotationRecord> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::RotationHistory)
                    .unwrap_or(Vec::new(env));
                history.push_back(RotationRecord {
                    old_admin: old_admin.clone(),
                    new_admin: new_admin.clone(),
                    rotated_at,
                });
                env.storage()
                    .persistent()
                    .set(&DataKey::RotationHistory, &history);

                env.events().publish(
                    (symbol_short!("admin"), symbol_short!("rotated")),
                    (old_admin, new_admin.clone(), rotated_at),
                );
            }
            CriticalOperation::ResultPublication(ballot_id_hash, result_hash) => {
                let result_key = DataKey::ResultHash(ballot_id_hash.clone());
                if let Some(existing) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, String>(&result_key)
                {
                    if existing == *result_hash {
                        return Ok(());
                    }
                    return Err(ContractError::ResultAlreadyPublished);
                }
                env.storage().persistent().set(&result_key, result_hash);
                let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
                let mut metadata = Self::require_ballot_metadata(env, ballot_id_hash)?;
                metadata.state = BallotState::ResultPublished;
                metadata.state_updated_at = env.ledger().timestamp();
                env.storage().persistent().set(&metadata_key, &metadata);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("res_pub")),
                    (ballot_id_hash.clone(), result_hash.clone()),
                );
            }
            CriticalOperation::Pause => {
                env.storage().instance().set(&DataKey::IsPaused, &true);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("paused")),
                    env.ledger().timestamp(),
                );
            }
            CriticalOperation::UpgradeScheduling(new_wasm_hash) => {
                if env.storage().instance().has(&DataKey::PendingUpgrade) {
                    return Err(ContractError::UpgradeAlreadyScheduled);
                }
                let now = env.ledger().timestamp();
                let pending = PendingUpgrade {
                    executable_at: now + UPGRADE_TIME_LOCK_SECONDS,
                    new_wasm_hash: new_wasm_hash.clone(),
                    scheduled_at: now,
                };
                env.storage()
                    .instance()
                    .set(&DataKey::PendingUpgrade, &pending);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("upg_schd")),
                    (
                        new_wasm_hash.clone(),
                        pending.scheduled_at,
                        pending.executable_at,
                    ),
                );
            }
        }
        Ok(())
    }

    /// Verifies the contract completed `initialize` and instance storage is consistent.
    fn verify_initialized(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .is_none()
        {
            Self::publish_init_inconsistency(env, symbol_short!("no_admin"));
            return Err(ContractError::NotInitialized);
        }

        if env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::InitializedAt)
            .is_none()
        {
            Self::publish_init_inconsistency(env, symbol_short!("no_ts"));
            return Err(ContractError::NotInitialized);
        }

        if env.storage().instance().get::<DataKey, bool>(&DataKey::IsPaused).is_none() {
            Self::publish_init_inconsistency(env, symbol_short!("no_pause"));
            return Err(ContractError::NotInitialized);
        }

        let approvers: Vec<Address> = match env
            .storage()
            .instance()
            .get::<DataKey, Vec<Address>>(&DataKey::Approvers)
        {
            Some(approvers) if !approvers.is_empty() => approvers,
            _ => {
                Self::publish_init_inconsistency(env, symbol_short!("no_appr"));
                return Err(ContractError::NotInitialized);
            }
        };

        let threshold_valid = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::ApprovalThreshold)
            .map(|threshold| threshold > 0 && threshold <= approvers.len())
            .unwrap_or(false);
        if !threshold_valid {
            Self::publish_init_inconsistency(env, symbol_short!("bad_thr"));
            return Err(ContractError::NotInitialized);
        }

        if env.storage().instance().get::<DataKey, u64>(&DataKey::OperationNonce).is_none() {
            Self::publish_init_inconsistency(env, symbol_short!("no_nonce"));
            return Err(ContractError::NotInitialized);
        }

        Ok(())
    }

    fn publish_init_inconsistency(env: &Env, reason: Symbol) {
        env.events().publish((symbol_short!("init"), symbol_short!("invalid")), reason);
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        Self::verify_initialized(env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if *caller != admin {
            return Err(ContractError::AdminUnauthorized);
        }
        Ok(())
    }

    fn contains_address(addresses: &Vec<Address>, target: &Address) -> bool {
        for address in addresses.iter() {
            if address == *target {
                return true;
            }
        }
        false
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
        {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    fn require_ballot_metadata(
        env: &Env,
        ballot_id_hash: &String,
    ) -> Result<BallotMetadata, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::BallotMetadata(ballot_id_hash.clone()))
            .ok_or(ContractError::BallotNotFound)
    }

    fn require_ballot_not_expired(env: &Env, ballot_id_hash: &String) -> Result<(), ContractError> {
        let explicitly_expired: bool = env
            .storage()
            .persistent()
            .get(&DataKey::BallotExpired(ballot_id_hash.clone()))
            .unwrap_or(false);
        if explicitly_expired {
            return Err(ContractError::BallotExpired);
        }
        Ok(())
    }
}

fn bytes_to_hex(env: &Env, bytes: &BytesN<32>) -> String {
    let arr = bytes.to_array();
    let mut buf = [0u8; 64];
    let hex_chars = b"0123456789abcdef";
    for i in 0..32 {
        let byte = arr[i];
        buf[i * 2] = hex_chars[(byte >> 4) as usize];
        buf[i * 2 + 1] = hex_chars[(byte & 0xf) as usize];
    }
    let rust_str = core::str::from_utf8(&buf).unwrap();
    String::from_str(env, rust_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup() -> (Env, AnonVoteContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    fn limits(max_tokens: u32, max_votes: u32) -> BallotLimits {
        BallotLimits {
            max_tokens,
            max_votes,
        }
    }

    fn configure_two_of_three(
        env: &Env,
        client: &AnonVoteContractClient,
        admin: &Address,
    ) -> (Address, Address, Address) {
        let first = Address::generate(env);
        let second = Address::generate(env);
        let third = Address::generate(env);
        let approvers = Vec::from_array(env, [first.clone(), second.clone(), third.clone()]);
        client.configure_approval_threshold(admin, &approvers, &2, &3);
        (first, second, third)
    }

    fn setup_uninitialized() -> (Env, AnonVoteContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        (env, client, admin, contract_id)
    }

    #[test]
    fn contract_is_valid_after_initialization() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "initialized");
        client.record_ballot(&admin, &ballot, &limits(10, 10));
        assert_eq!(client.get_admin(), Some(admin));
        assert_eq!(client.get_tokens_issued(&ballot), Some(0));
    }

    #[test]
    fn write_operations_reject_uninitialized_contract() {
        let (env, client, admin, _) = setup_uninitialized();
        let ballot = String::from_str(&env, "uninitialized");
        let approver = Address::generate(&env);

        assert_eq!(
            client.try_record_ballot(&admin, &ballot, &limits(1, 1)),
            Err(Ok(ContractError::NotInitialized))
        );
        assert_eq!(
            client.try_configure_approval_threshold(
                &admin,
                &Vec::from_array(&env, [approver.clone()]),
                &1,
                &1,
            ),
            Err(Ok(ContractError::NotInitialized))
        );
        assert_eq!(
            client.try_approve_operation(&1, &approver),
            Err(Ok(ContractError::NotInitialized))
        );
        assert_eq!(
            client.try_execute_upgrade(),
            Err(Ok(ContractError::NotInitialized))
        );
    }

    #[test]
    fn partial_initialization_is_rejected() {
        let (env, client, admin, contract_id) = setup_uninitialized();
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Admin, &admin);
        });

        let ballot = String::from_str(&env, "partial");
        assert_eq!(
            client.try_record_ballot(&admin, &ballot, &limits(1, 1)),
            Err(Ok(ContractError::NotInitialized))
        );
    }

    #[test]
    fn insufficient_approvals_block_result_publication() {
        let (env, client, admin) = setup();
        let (first, second, _) = configure_two_of_three(&env, &client, &admin);
        let ballot = String::from_str(&env, "ballot");
        let result = String::from_str(&env, "result");
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let operation_id = client.record_result(&admin, &ballot, &result);
        assert!(!client.approve_operation(&operation_id, &first));
        assert_eq!(client.get_result_hash(&ballot), None);
        assert!(client.approve_operation(&operation_id, &second));
        assert_eq!(client.get_result_hash(&ballot), Some(result));
    }

    #[test]
    fn duplicate_and_non_approver_signatures_are_rejected() {
        let (env, client, admin) = setup();
        let (first, _, _) = configure_two_of_three(&env, &client, &admin);
        let outsider = Address::generate(&env);
        let operation_id = client.pause_contract(&admin);

        assert_eq!(
            client.try_approve_operation(&operation_id, &outsider),
            Err(Ok(ContractError::ApproverUnauthorized))
        );
        assert!(!client.approve_operation(&operation_id, &first));
        assert_eq!(
            client.try_approve_operation(&operation_id, &first),
            Err(Ok(ContractError::OperationAlreadyApproved))
        );
        assert!(!client.is_paused());
    }

    #[test]
    fn threshold_approval_executes_admin_rotation_and_pause() {
        let (env, client, admin) = setup();
        let (first, second, third) = configure_two_of_three(&env, &client, &admin);
        let new_admin = Address::generate(&env);

        let rotation = client.rotate_admin(&admin, &new_admin);
        assert!(!client.approve_operation(&rotation, &first));
        assert!(client.approve_operation(&rotation, &second));
        assert_eq!(client.get_admin(), Some(new_admin.clone()));

        let pause = client.pause_contract(&new_admin);
        assert!(!client.approve_operation(&pause, &second));
        assert!(client.approve_operation(&pause, &third));
        assert!(client.is_paused());
    }

    #[test]
    fn cancelled_and_expired_operations_cannot_execute() {
        let (env, client, admin) = setup();
        let (first, second, _) = configure_two_of_three(&env, &client, &admin);
        let cancelled = client.create_operation(&admin, &CriticalOperation::Pause);
        client.cancel_operation(&admin, &cancelled);
        assert_eq!(
            client.try_approve_operation(&cancelled, &first),
            Err(Ok(ContractError::OperationNotPending))
        );

        let expired = client.create_operation(&admin, &CriticalOperation::Pause);
        env.ledger().with_mut(|ledger| {
            ledger.timestamp += APPROVAL_EXPIRATION_SECONDS + 1;
        });
        assert_eq!(
            client.try_approve_operation(&expired, &second),
            Err(Ok(ContractError::OperationExpired))
        );
        assert!(!client.is_paused());
    }

    #[test]
    fn approval_configuration_is_validated() {
        let (env, client, admin) = setup();
        let approver = Address::generate(&env);
        let duplicate = Vec::from_array(&env, [approver.clone(), approver]);
        assert_eq!(
            client.try_configure_approval_threshold(&admin, &duplicate, &2, &2),
            Err(Ok(ContractError::DuplicateApprover))
        );
        assert_eq!(
            client.try_configure_approval_threshold(&admin, &duplicate, &3, &2),
            Err(Ok(ContractError::InvalidApprovalConfig))
        );
    }

    #[test]
    fn pending_operation_keeps_its_original_governance_configuration() {
        let (env, client, admin) = setup();
        let (first, second, _) = configure_two_of_three(&env, &client, &admin);
        let operation_id = client.pause_contract(&admin);

        let replacement = Address::generate(&env);
        let replacement_approvers = Vec::from_array(&env, [replacement.clone()]);
        client.configure_approval_threshold(&admin, &replacement_approvers, &1, &1);

        assert_eq!(
            client.try_approve_operation(&operation_id, &replacement),
            Err(Ok(ContractError::ApproverUnauthorized))
        );
        assert!(!client.approve_operation(&operation_id, &first));
        assert!(client.approve_operation(&operation_id, &second));
        assert!(client.is_paused());
    }

    #[test]
    fn upgrade_is_scheduled_only_after_threshold_approval() {
        let (env, client, admin) = setup();
        let (first, second, _) = configure_two_of_three(&env, &client, &admin);
        let wasm_hash = BytesN::from_array(&env, &[7; 32]);

        let operation_id = client.schedule_upgrade(&admin, &wasm_hash);
        assert!(!client.approve_operation(&operation_id, &first));
        assert_eq!(client.get_pending_upgrade(), None);

        assert!(client.approve_operation(&operation_id, &second));
        let upgrade = client.get_pending_upgrade().unwrap();
        assert_eq!(upgrade.new_wasm_hash, wasm_hash);
        assert_eq!(
            upgrade.executable_at,
            upgrade.scheduled_at + UPGRADE_TIME_LOCK_SECONDS
        );
    }

    #[test]
    fn admin_rotation_stores_history_and_emits_event() {
        let (env, client, admin) = setup();
        let new_admin = Address::generate(&env);

        // Rotate via 1-of-1 (default threshold after initialize)
        let op_id = client.rotate_admin(&admin, &new_admin);
        client.approve_operation(&op_id, &admin);

        // New admin is set
        assert_eq!(client.get_admin(), Some(new_admin.clone()));

        // Rotation history has one entry
        let history = client.get_rotation_history();
        assert_eq!(history.len(), 1);
        let record = history.get(0).unwrap();
        assert_eq!(record.old_admin, admin);
        assert_eq!(record.new_admin, new_admin);
        assert_eq!(record.rotated_at, env.ledger().timestamp());
    }

    #[test]
    fn old_admin_loses_privileges_immediately_after_rotation() {
        let (env, client, admin) = setup();
        let new_admin = Address::generate(&env);

        let op_id = client.rotate_admin(&admin, &new_admin);
        client.approve_operation(&op_id, &admin);

        // Old admin can no longer create operations
        assert_eq!(
            client.try_rotate_admin(&admin, &Address::generate(&env)),
            Err(Ok(ContractError::AdminUnauthorized))
        );

        // New admin can create operations
        let third = Address::generate(&env);
        let op2 = client.rotate_admin(&new_admin, &third);
        client.approve_operation(&op2, &new_admin);
        assert_eq!(client.get_admin(), Some(third));
    }

    #[test]
    fn rotation_to_same_admin_is_rejected() {
        let (env, client, admin) = setup();

        // validate_operation fires during create_operation, before any approval
        assert_eq!(
            client.try_rotate_admin(&admin, &admin),
            Err(Ok(ContractError::SameAdmin))
        );
    }

    #[test]
    fn rotation_history_accumulates_multiple_records() {
        let (env, client, admin) = setup();
        let second = Address::generate(&env);
        let third = Address::generate(&env);

        let op1 = client.rotate_admin(&admin, &second);
        client.approve_operation(&op1, &admin);

        env.ledger().with_mut(|l| l.timestamp += 100);

        let op2 = client.rotate_admin(&second, &third);
        client.approve_operation(&op2, &second);

        let history = client.get_rotation_history();
        assert_eq!(history.len(), 2);
        assert_eq!(history.get(0).unwrap().new_admin, second);
        assert_eq!(history.get(1).unwrap().new_admin, third);
        // timestamps differ
        assert!(history.get(1).unwrap().rotated_at > history.get(0).unwrap().rotated_at);
    }

    #[test]
    fn ballot_limits_and_counts_still_work() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "limited");
        client.record_ballot(&admin, &ballot, &limits(1, 1));
        client.record_token(&admin, &ballot);
        client.record_vote(&admin, &ballot);
        assert_eq!(client.get_tokens_issued(&ballot), Some(1));
        assert_eq!(client.get_votes_cast(&ballot), Some(1));
        assert!(client.is_consistent(&ballot));
        assert_eq!(
            client.try_record_token(&admin, &ballot),
            Err(Ok(ContractError::LimitExceeded))
        );
    }

    #[test]
    fn ballot_audit_report_works() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "audit-ballot");
        
        // Report for non-existent ballot should be None
        assert_eq!(client.get_audit_report(&ballot), None);

        // Record ballot
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        // Get report
        let report = client.get_audit_report(&ballot).unwrap();
        assert_eq!(report.admin, admin);
        assert_eq!(report.created_at, env.ledger().timestamp());
        assert_eq!(report.expiration_time, 0);
        assert!(report.is_consistent);
        assert_eq!(report.result_hash, None);
        assert_eq!(report.state, BallotState::Active);
        assert_eq!(report.tokens_issued, 0);
        assert_eq!(report.votes_cast, 0);

        // Record tokens/votes and assert matches individual reads
        client.record_token(&admin, &ballot);
        client.record_vote(&admin, &ballot);
        
        let report2 = client.get_audit_report(&ballot).unwrap();
        assert_eq!(report2.tokens_issued, client.get_tokens_issued(&ballot).unwrap());
        assert_eq!(report2.votes_cast, client.get_votes_cast(&ballot).unwrap());
        assert_eq!(report2.is_consistent, client.is_consistent(&ballot));
        assert!(report2.is_consistent);

        // Make inconsistent
        client.record_token(&admin, &ballot);
        let report3 = client.get_audit_report(&ballot).unwrap();
        assert_eq!(report3.tokens_issued, 2);
        assert_eq!(report3.votes_cast, 1);
        assert_eq!(report3.is_consistent, client.is_consistent(&ballot));
        assert!(!report3.is_consistent);

        // Publish result
        let result = String::from_str(&env, "election-result");
        let operation_id = client.record_result(&admin, &ballot, &result);
        client.approve_operation(&operation_id, &admin);

        let report4 = client.get_audit_report(&ballot).unwrap();
        assert_eq!(report4.state, BallotState::ResultPublished);
        assert_eq!(report4.result_hash, Some(result));
    }

    #[test]
    fn verify_result_proof_works() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "merkle-ballot");
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0_bytes = [1u8; 32];
        let leaf1_bytes = [2u8; 32];
        let leaf0 = BytesN::from_array(&env, &leaf0_bytes);
        let leaf1 = BytesN::from_array(&env, &leaf1_bytes);

        let mut data = Bytes::new(&env);
        data.extend_from_array(&leaf0_bytes);
        data.extend_from_array(&leaf1_bytes);
        let root: BytesN<32> = env.crypto().sha256(&data).into();
        let root_hex = bytes_to_hex(&env, &root);

        // Try verification before result is published - should fail with BallotNotFound
        let proof0 = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };
        let res = client.try_verify_result_proof(&ballot, &proof0, &root_hex);
        assert_eq!(res, Err(Ok(ContractError::BallotNotFound)));

        // Publish result
        let op_id = client.record_result(&admin, &ballot, &root_hex);
        client.approve_operation(&op_id, &admin);

        // Verify valid proof for leaf 0
        assert!(client.verify_result_proof(&ballot, &proof0, &root_hex));

        // Verify valid proof for leaf 1
        let proof1 = MerkleProof {
            vote_hash: leaf1.clone(),
            path: Vec::from_array(&env, [leaf0.clone()]),
            index: 1,
        };
        assert!(client.verify_result_proof(&ballot, &proof1, &root_hex));

        // Verify valid proof for a single-node tree (empty path, leaf is root)
        let single_root_hex = bytes_to_hex(&env, &leaf0);
        let ballot_single = String::from_str(&env, "single-node-ballot");
        client.record_ballot(&admin, &ballot_single, &limits(10, 10));
        let op_id_single = client.record_result(&admin, &ballot_single, &single_root_hex);
        client.approve_operation(&op_id_single, &admin);

        let proof_single = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::new(&env),
            index: 0,
        };
        assert!(client.verify_result_proof(&ballot_single, &proof_single, &single_root_hex));

        // Verify invalid proof: invalid vote hash
        let invalid_vote_proof = MerkleProof {
            vote_hash: BytesN::from_array(&env, &[0u8; 32]),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };
        assert!(!client.verify_result_proof(&ballot, &invalid_vote_proof, &root_hex));

        // Verify invalid proof: invalid path (wrong sibling hash)
        let invalid_path_proof = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [BytesN::from_array(&env, &[0u8; 32])]),
            index: 0,
        };
        assert!(!client.verify_result_proof(&ballot, &invalid_path_proof, &root_hex));

        // Verify invalid proof: wrong index
        let invalid_idx_proof = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 1,
        };
        assert!(!client.verify_result_proof(&ballot, &invalid_idx_proof, &root_hex));

        // Verify mismatching result_hash parameter
        let wrong_root_hex = String::from_str(&env, "0000000000000000000000000000000000000000000000000000000000000000");
        assert!(!client.verify_result_proof(&ballot, &proof0, &wrong_root_hex));

        // Verify non-existent ballot
        let non_existent_ballot = String::from_str(&env, "non-existent-ballot");
        let res = client.try_verify_result_proof(&non_existent_ballot, &proof0, &root_hex);
        assert_eq!(res, Err(Ok(ContractError::BallotNotFound)));
    }

    #[test]
    fn get_ballot_created_at_returns_timestamp_set_at_creation() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "ts-ballot");

        // Before creation: returns None
        assert_eq!(client.get_ballot_created_at(&ballot), None);

        // Record at a known timestamp
        let creation_time = env.ledger().timestamp();
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        // After creation: returns the ledger timestamp at creation
        assert_eq!(client.get_ballot_created_at(&ballot), Some(creation_time));
    }

    #[test]
    fn get_ballot_created_at_is_immutable_after_state_changes() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "immutable-ts-ballot");

        client.record_ballot(&admin, &ballot, &limits(10, 10));
        let creation_time = client.get_ballot_created_at(&ballot).unwrap();

        // Advance ledger time, record tokens and votes
        env.ledger().with_mut(|l| l.timestamp += 100);
        client.record_token(&admin, &ballot);
        client.record_vote(&admin, &ballot);

        // Timestamp must not change
        assert_eq!(client.get_ballot_created_at(&ballot), Some(creation_time));

        // Advance again and publish result; timestamp still unchanged
        env.ledger().with_mut(|l| l.timestamp += 100);
        let result = String::from_str(&env, "result-hash");
        let op_id = client.record_result(&admin, &ballot, &result);
        client.approve_operation(&op_id, &admin);

        assert_eq!(client.get_ballot_created_at(&ballot), Some(creation_time));
    }

    #[test]
    fn get_ballot_created_at_matches_metadata_and_audit_report() {
        let (env, client, admin) = setup();
        let ballot = String::from_str(&env, "cross-check-ballot");

        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let created_at = client.get_ballot_created_at(&ballot).unwrap();
        let metadata   = client.get_ballot_metadata(&ballot).unwrap();
        let report     = client.get_audit_report(&ballot).unwrap();

        assert_eq!(created_at, metadata.created_at);
        assert_eq!(created_at, report.created_at);
    }

    #[test]
    fn ballots_created_at_different_ledger_times_have_distinct_timestamps() {
        let (env, client, admin) = setup();
        let ballot_a = String::from_str(&env, "ballot-a");
        let ballot_b = String::from_str(&env, "ballot-b");

        client.record_ballot(&admin, &ballot_a, &limits(10, 10));
        let ts_a = client.get_ballot_created_at(&ballot_a).unwrap();

        // Advance ledger time before creating second ballot
        env.ledger().with_mut(|l| l.timestamp += 60);
        client.record_ballot(&admin, &ballot_b, &limits(10, 10));
        let ts_b = client.get_ballot_created_at(&ballot_b).unwrap();

        assert!(ts_b > ts_a);
        assert_eq!(ts_b - ts_a, 60);
    }

    // ── record_ballots_batch tests ────────────────────────────────────────

    #[test]
    fn batch_records_all_ballots_and_returns_hashes() {
        let (env, client, admin) = setup();
        let id_a = String::from_str(&env, "batch-a");
        let id_b = String::from_str(&env, "batch-b");
        let id_c = String::from_str(&env, "batch-c");

        let ballots = Vec::from_array(
            &env,
            [
                (id_a.clone(), limits(10, 10)),
                (id_b.clone(), limits(20, 20)),
                (id_c.clone(), limits(30, 30)),
            ],
        );

        let recorded = client.record_ballots_batch(&admin, &ballots);
        assert_eq!(recorded.len(), 3);
        assert_eq!(recorded.get(0).unwrap(), id_a);
        assert_eq!(recorded.get(1).unwrap(), id_b);
        assert_eq!(recorded.get(2).unwrap(), id_c);

        // All ballots exist on-chain with correct initial state
        for id in [&id_a, &id_b, &id_c] {
            assert!(client.ballot_exists(id));
            assert_eq!(client.get_tokens_issued(id), Some(0));
            assert_eq!(client.get_votes_cast(id), Some(0));
            let meta = client.get_ballot_metadata(id).unwrap();
            assert_eq!(meta.state, BallotState::Active);
        }
    }

    #[test]
    fn batch_fails_atomically_when_any_ballot_hash_is_empty() {
        let (env, client, admin) = setup();
        let id_a = String::from_str(&env, "atomic-a");
        let empty = String::from_str(&env, "");

        let ballots = Vec::from_array(
            &env,
            [
                (id_a.clone(), limits(10, 10)),
                (empty, limits(10, 10)),
            ],
        );

        assert_eq!(
            client.try_record_ballots_batch(&admin, &ballots),
            Err(Ok(ContractError::InvalidBallotHash))
        );

        // First ballot must NOT have been written (atomic rollback)
        assert!(!client.ballot_exists(&id_a));
    }

    #[test]
    fn batch_fails_atomically_when_any_ballot_already_exists() {
        let (env, client, admin) = setup();
        let existing = String::from_str(&env, "already-exists");
        let new_one = String::from_str(&env, "brand-new");

        // Pre-record the first ballot
        client.record_ballot(&admin, &existing, &limits(5, 5));

        let ballots = Vec::from_array(
            &env,
            [
                (new_one.clone(), limits(10, 10)),
                (existing, limits(10, 10)),
            ],
        );

        assert_eq!(
            client.try_record_ballots_batch(&admin, &ballots),
            Err(Ok(ContractError::BallotAlreadyExists))
        );

        // new_one must NOT have been written (atomic rollback)
        assert!(!client.ballot_exists(&new_one));
    }

    #[test]
    fn batch_is_rejected_when_contract_is_paused() {
        let (env, client, admin) = setup();

        // Pause the contract via governance
        let op_id = client.pause_contract(&admin);
        client.approve_operation(&op_id, &admin);
        assert!(client.is_paused());

        let id = String::from_str(&env, "paused-ballot");
        let ballots = Vec::from_array(&env, [(id, limits(10, 10))]);

        assert_eq!(
            client.try_record_ballots_batch(&admin, &ballots),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn batch_is_rejected_by_non_admin() {
        let (env, client, admin) = setup();
        let non_admin = Address::generate(&env);
        let id = String::from_str(&env, "unauth-batch");
        let ballots = Vec::from_array(&env, [(id, limits(10, 10))]);

        // Should be rejected — only admin can record ballots
        assert_eq!(
            client.try_record_ballots_batch(&non_admin, &ballots),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn single_item_batch_matches_record_ballot_behavior() {
        let (env, client, admin) = setup();
        let id = String::from_str(&env, "single-batch");

        let ballots = Vec::from_array(&env, [(id.clone(), limits(5, 7))]);
        let recorded = client.record_ballots_batch(&admin, &ballots);

        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded.get(0).unwrap(), id);

        let meta = client.get_ballot_metadata(&id).unwrap();
        assert_eq!(meta.limits.max_tokens, 5);
        assert_eq!(meta.limits.max_votes, 7);
        assert_eq!(meta.admin, admin);
        assert_eq!(meta.state, BallotState::Active);
    }
}
