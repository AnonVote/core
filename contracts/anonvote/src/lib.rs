//! AnonVote Soroban smart contract.
//!
//! The contract stores public ballot audit data and protects critical
//! governance operations with configurable M-of-N multi-sig approval,
//! time locks, parameter guards, and activity tracking.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    String, Symbol, Vec,
};

mod validation;
use validation::validate_hex_hash;

const APPROVAL_EXPIRATION_SECONDS: u64 = 30 * 24 * 60 * 60; // 30 days in seconds
const UPGRADE_TIME_LOCK_SECONDS: u64 = 48 * 60 * 60; // 48 hours in seconds
const REJECTION_COOLDOWN_SECONDS: u64 = 24 * 60 * 60; // 24 hours in seconds
const KEY_ROTATION_COOLDOWN: u64 = 86400; // 24 hours in seconds
const MIN_APPROVERS: u32 = 2;
const MAX_APPROVERS: u32 = 10;

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
    InvalidBallotIdHash = 23,
    InvalidResultHash = 24,
    InternalError = 25,
    // Admin key rotation errors
    InvalidAdminKey = 26,
    KeyRotationAlreadyPending = 27,
    NoKeyRotationPending = 28,
    RotationTooSoon = 29,
    KeyRotationUnauthorized = 30,
    AdminKeyNotInitialized = 31,
    // Governance errors
    CooldownActive = 32,
    OperationRejected = 33,
    ThresholdNotMet = 34,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BallotState {
    Active,
    Expired,
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

/// Soroban-compatible optional key wrapper (`Option<BytesN<32>>` is not directly serialisable).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OptionalKey {
    None,
    Some(BytesN<32>),
}

/// Info returned by `get_admin_key_info`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminKeyInfo {
    pub current_key: BytesN<32>,
    pub pending_key: OptionalKey,
    pub rotation_count: u32,
    pub last_rotation_time: u64,
    pub seconds_until_confirmation: u64,
}

/// Typed, structured audit events for external indexers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BallotEvent {
    BallotCreated(String, u64),
    TokenRecorded(String, u32),
    VoteRecorded(String, u32),
    ResultPublished(String, String),
    BallotExpired(String, u64),
}

/// Operations that must be approved by the configured M-of-N approvers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationType {
    PauseContract,
    UnpauseContract,
    ChangeThreshold(u32),
    AddApprover(Address),
    RemoveApprover(Address),
    UpgradeContract(BytesN<32>),
    ResultPublication(String, String),
    AdminRotation(Address),
}

pub type CriticalOperation = OperationType;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationStatus {
    Pending,
    Executed,
    Cancelled,
    Rejected,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingOperation {
    pub approval_count: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub id: u64,
    pub operation: OperationType,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub rejections: Vec<Address>,
    pub status: OperationStatus,
    pub threshold: u32,
    pub time_lock_until: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApproverActivity {
    pub approval_count: u32,
    pub last_active: u64,
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
    Rejection(u64, Address),
    TokensIssued(String),
    VotesCast(String),
    ResultHash(String),
    BallotMetadata(String),
    PendingUpgrade,
    RotationHistory,
    // Admin key (BytesN<32>) rotation state
    AdminKey,
    PendingAdminKey,
    KeyRotationRequestedAt,
    KeyRotationCount,
    LastKeyRotationTime,
    ApproverActivity(Address),
    RejectionCooldown(OperationType),
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    /// Returns the semantic version of this contract package.
    pub fn get_version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Initializes the contract with an M-of-N approver set and approval threshold.
    pub fn initialize(env: Env, approvers: Vec<Address>, threshold: u32) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Approvers) || env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        Self::validate_approvers_and_threshold(&approvers, threshold)?;

        let first_admin = approvers.get(0).unwrap();
        env.storage().instance().set(&DataKey::Admin, &first_admin);
        env.storage().instance().set(&DataKey::Approvers, &approvers);
        env.storage().instance().set(&DataKey::ApprovalThreshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::InitializedAt, &env.ledger().timestamp());
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage()
            .instance()
            .set(&DataKey::OperationNonce, &0u64);
        Ok(())
    }

    /// Replaces the approver set and configures the M-of-N threshold.
    pub fn configure_approval_threshold(
        env: Env,
        caller: Address,
        approvers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::validate_approvers_and_threshold(&approvers, threshold)?;

        env.storage()
            .instance()
            .set(&DataKey::Approvers, &approvers);
        env.storage()
            .instance()
            .set(&DataKey::ApprovalThreshold, &threshold);
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("cfg_appr")),
            (caller, threshold, approvers.len() as u32),
        );
        Ok(())
    }

    /// Proposes an operation for M-of-N approval.
    pub fn propose_operation(
        env: Env,
        caller: Address,
        op_type: OperationType,
    ) -> Result<u64, ContractError> {
        caller.require_auth();
        if op_type != OperationType::UnpauseContract {
            Self::require_not_paused(&env)?;
        }
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &caller) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let cooldown_key = DataKey::RejectionCooldown(op_type.clone());
        if let Some(rejected_at) = env.storage().persistent().get::<_, u64>(&cooldown_key) {
            let now = env.ledger().timestamp();
            if now.saturating_sub(rejected_at) < REJECTION_COOLDOWN_SECONDS {
                return Err(ContractError::CooldownActive);
            }
        }

        Self::validate_operation(&env, &op_type)?;

        let operation_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OperationNonce)
            .unwrap_or(0);
        let next_id = operation_id
            .checked_add(1)
            .ok_or(ContractError::CounterOverflow)?;

        let created_at = env.ledger().timestamp();
        let time_lock_until = created_at + UPGRADE_TIME_LOCK_SECONDS;
        let expires_at = created_at + APPROVAL_EXPIRATION_SECONDS;
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ApprovalThreshold)
            .ok_or(ContractError::NotInitialized)?;

        let mut approvals = Vec::new(&env);
        approvals.push_back(caller.clone());
        Self::update_approver_activity(&env, &caller)?;

        let pending = PendingOperation {
            approval_count: 1,
            created_at,
            expires_at,
            id: operation_id,
            operation: op_type.clone(),
            proposer: caller.clone(),
            approvals,
            rejections: Vec::new(&env),
            status: OperationStatus::Pending,
            threshold,
            time_lock_until,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Operation(operation_id), &pending);
        env.storage()
            .persistent()
            .set(&DataKey::Approval(operation_id, caller.clone()), &true);
        for approver in approvers.iter() {
            env.storage()
                .persistent()
                .set(&DataKey::OperationApprover(operation_id, approver), &true);
        }
        env.storage()
            .instance()
            .set(&DataKey::OperationNonce, &next_id);

        env.events().publish(
            (symbol_short!("govern"), symbol_short!("op_prop")),
            (operation_id, caller, created_at, expires_at),
        );
        Ok(operation_id)
    }

    /// Alias for propose_operation to preserve backward compatibility.
    pub fn create_operation(
        env: Env,
        caller: Address,
        operation: CriticalOperation,
    ) -> Result<u64, ContractError> {
        Self::propose_operation(env, caller, operation)
    }

    /// Proposes result publication for M-of-N approval.
    pub fn record_result(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        result_hash: String,
    ) -> Result<u64, ContractError> {
        Self::require_not_paused(&env)?;
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }
        if !is_valid_sha256_hex(&result_hash) {
            return Err(ContractError::InvalidResultHash);
        }
        Self::require_ballot_metadata(&env, &ballot_id_hash)?;
        Self::propose_operation(
            env,
            caller,
            OperationType::ResultPublication(ballot_id_hash, result_hash),
        )
    }

    /// Proposes admin rotation for M-of-N approval.
    pub fn rotate_admin(
        env: Env,
        caller: Address,
        new_admin: Address,
    ) -> Result<u64, ContractError> {
        Self::require_not_paused(&env)?;
        Self::propose_operation(env, caller, OperationType::AdminRotation(new_admin))
    }

    /// Proposes pausing the contract for M-of-N approval.
    pub fn pause_contract(env: Env, caller: Address) -> Result<u64, ContractError> {
        Self::propose_operation(env, caller, OperationType::PauseContract)
    }

    /// Proposes unpausing the contract for M-of-N approval.
    pub fn unpause_contract(env: Env, caller: Address) -> Result<u64, ContractError> {
        Self::propose_operation(env, caller, OperationType::UnpauseContract)
    }

    /// Proposes scheduling a time-locked upgrade for M-of-N approval.
    pub fn schedule_upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<u64, ContractError> {
        Self::require_not_paused(&env)?;
        Self::propose_operation(
            env,
            caller,
            OperationType::UpgradeContract(new_wasm_hash),
        )
    }

    /// Approves a pending operation.
    pub fn approve_operation(
        env: Env,
        operation_id: u64,
        approver_address: Address,
    ) -> Result<bool, ContractError> {
        approver_address.require_auth();
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &approver_address) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;

        if pending.operation != OperationType::UnpauseContract {
            Self::require_not_paused(&env)?;
        }

        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }

        let now = env.ledger().timestamp();
        if now > pending.expires_at {
            pending.status = OperationStatus::Expired;
            env.storage().persistent().set(&key, &pending);
            return Err(ContractError::OperationExpired);
        }

        let approval_key = DataKey::Approval(operation_id, approver_address.clone());
        if env.storage().persistent().has(&approval_key) || Self::contains_address(&pending.approvals, &approver_address) {
            return Err(ContractError::OperationAlreadyApproved);
        }

        pending.approvals.push_back(approver_address.clone());
        pending.approval_count = Self::count_valid_approvals(&approvers, &pending.approvals);
        env.storage().persistent().set(&approval_key, &true);
        Self::update_approver_activity(&env, &approver_address)?;

        env.events().publish(
            (symbol_short!("govern"), symbol_short!("approved")),
            (
                operation_id,
                approver_address.clone(),
                pending.approval_count,
                pending.threshold,
            ),
        );

        if pending.approval_count < pending.threshold {
            env.storage().persistent().set(&key, &pending);
            return Ok(false);
        }

        if now >= pending.time_lock_until {
            Self::execute_operation_internal(&env, &mut pending)?;
            env.storage().persistent().set(&key, &pending);
            return Ok(true);
        }

        env.storage().persistent().set(&key, &pending);
        Ok(false)
    }

    /// Executes an approved operation after its 48-hour time lock has expired.
    pub fn execute_operation(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &caller) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;

        if pending.operation != OperationType::UnpauseContract {
            Self::require_not_paused(&env)?;
        }

        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }

        let now = env.ledger().timestamp();
        if now > pending.expires_at {
            pending.status = OperationStatus::Expired;
            env.storage().persistent().set(&key, &pending);
            return Err(ContractError::OperationExpired);
        }

        let valid_approval_count = Self::count_valid_approvals(&approvers, &pending.approvals);
        pending.approval_count = valid_approval_count;
        if valid_approval_count < pending.threshold {
            return Err(ContractError::ThresholdNotMet);
        }

        if now < pending.time_lock_until {
            return Err(ContractError::TimeLockNotExpired);
        }

        Self::execute_operation_internal(&env, &mut pending)?;
        env.storage().persistent().set(&key, &pending);
        Ok(())
    }

    /// Emergency execution for an approved operation, skipping the 48-hour time lock.
    pub fn emergency_execute(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &caller) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;

        if pending.operation != OperationType::UnpauseContract {
            Self::require_not_paused(&env)?;
        }

        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }

        let now = env.ledger().timestamp();
        if now > pending.expires_at {
            pending.status = OperationStatus::Expired;
            env.storage().persistent().set(&key, &pending);
            return Err(ContractError::OperationExpired);
        }

        let valid_approval_count = Self::count_valid_approvals(&approvers, &pending.approvals);
        pending.approval_count = valid_approval_count;
        if valid_approval_count < pending.threshold {
            return Err(ContractError::ThresholdNotMet);
        }

        Self::execute_operation_internal(&env, &mut pending)?;
        env.storage().persistent().set(&key, &pending);
        Ok(())
    }

    /// Rejects a pending operation. If a majority of approvers reject, operation status becomes Rejected.
    pub fn reject_operation(
        env: Env,
        caller: Address,
        operation_id: u64,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &caller) {
            return Err(ContractError::ApproverUnauthorized);
        }

        let key = DataKey::Operation(operation_id);
        let mut pending: PendingOperation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::OperationNotFound)?;

        if pending.status != OperationStatus::Pending {
            return Err(ContractError::OperationNotPending);
        }

        let rejection_key = DataKey::Rejection(operation_id, caller.clone());
        if env.storage().persistent().has(&rejection_key) || Self::contains_address(&pending.rejections, &caller) {
            return Err(ContractError::OperationAlreadyApproved);
        }

        pending.rejections.push_back(caller.clone());
        env.storage().persistent().set(&rejection_key, &true);
        Self::update_approver_activity(&env, &caller)?;

        let now = env.ledger().timestamp();
        let total_approvers = approvers.len();
        if pending.rejections.len() > total_approvers / 2 {
            pending.status = OperationStatus::Rejected;
            let cooldown_key = DataKey::RejectionCooldown(pending.operation.clone());
            env.storage().persistent().set(&cooldown_key, &now);

            env.events().publish(
                (symbol_short!("govern"), symbol_short!("op_rej")),
                (operation_id, reason, now),
            );
        }

        env.storage().persistent().set(&key, &pending);
        Ok(())
    }

    /// Cancels a pending operation before it reaches its approval threshold.
    pub fn cancel_operation(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::verify_initialized(&env)?;

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::contains_address(&approvers, &caller) {
            return Err(ContractError::ApproverUnauthorized);
        }

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
            (symbol_short!("govern"), symbol_short!("op_cncl")),
            (operation_id, caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Returns approver activity stats (approval count and last active timestamp).
    pub fn get_approver_activity(env: Env, approver: Address) -> Option<ApproverActivity> {
        env.storage()
            .persistent()
            .get(&DataKey::ApproverActivity(approver))
    }

    /// Records multiple ballots atomically.
    pub fn record_ballots_batch(
        env: Env,
        caller: Address,
        ballots: Vec<(String, BallotLimits)>,
    ) -> Result<Vec<String>, ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        for i in 0..ballots.len() {
            let (ballot_id_hash, _) = ballots.get(i).unwrap();
            if !is_valid_sha256_hex(&ballot_id_hash) {
                return Err(ContractError::InvalidBallotIdHash);
            }
            let key = DataKey::BallotMetadata(ballot_id_hash.clone());
            if env.storage().persistent().has(&key) {
                return Err(ContractError::BallotAlreadyExists);
            }
        }

        let now = env.ledger().timestamp();
        let mut recorded: Vec<String> = Vec::new(&env);

        for i in 0..ballots.len() {
            let (ballot_id_hash, limits) = ballots.get(i).unwrap();
            let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
            let metadata = BallotMetadata {
                admin: caller.clone(),
                created_at: now,
                expiration_time: 0,
                limits,
                state: BallotState::Active,
                state_updated_at: now,
            };
            env.storage().persistent().set(&metadata_key, &metadata);
            let tokens_key = DataKey::TokensIssued(ballot_id_hash.clone());
            let votes_key = DataKey::VotesCast(ballot_id_hash.clone());
            env.storage().persistent().set(&tokens_key, &0u32);
            env.storage().persistent().set(&votes_key, &0u32);
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
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }

        let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
        if env.storage().persistent().has(&metadata_key) {
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
        env.storage().persistent().set(&metadata_key, &metadata);

        let tokens_key = DataKey::TokensIssued(ballot_id_hash.clone());
        let votes_key = DataKey::VotesCast(ballot_id_hash.clone());
        env.storage().persistent().set(&tokens_key, &0u32);
        env.storage().persistent().set(&votes_key, &0u32);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("blt_crtd")),
            (ballot_id_hash.clone(), now, caller),
        );
        env.events().publish(
            (symbol_short!("ballot"),),
            BallotEvent::BallotCreated(ballot_id_hash, now),
        );
        Ok(())
    }

    pub fn record_token(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        validate_hex_hash(&env, &ballot_id_hash, ContractError::InvalidBallotIdHash)?;
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        let metadata = Self::require_ballot_metadata_and_not_expired(&env, &ballot_id_hash)?;

        let key = DataKey::TokensIssued(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        if count >= metadata.limits.max_tokens {
            return Err(ContractError::LimitExceeded);
        }
        let new_count = count.checked_add(1).ok_or(ContractError::CounterOverflow)?;
        env.storage().persistent().set(&key, &new_count);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("tok_issd")),
            (ballot_id_hash.clone(), new_count),
        );
        env.events().publish(
            (symbol_short!("ballot"),),
            BallotEvent::TokenRecorded(ballot_id_hash, new_count),
        );
        Ok(())
    }

    pub fn record_vote(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        validate_hex_hash(&env, &ballot_id_hash, ContractError::InvalidBallotIdHash)?;
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        let metadata = Self::require_ballot_metadata_and_not_expired(&env, &ballot_id_hash)?;

        let key = DataKey::VotesCast(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        if count >= metadata.limits.max_votes {
            return Err(ContractError::LimitExceeded);
        }
        let new_count = count.checked_add(1).ok_or(ContractError::CounterOverflow)?;
        env.storage().persistent().set(&key, &new_count);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("vote_cast")),
            (ballot_id_hash.clone(), new_count),
        );
        env.events().publish(
            (symbol_short!("ballot"),),
            BallotEvent::VoteRecorded(ballot_id_hash, new_count),
        );
        Ok(())
    }

    pub fn expire_ballot(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        validate_hex_hash(&env, &ballot_id_hash, ContractError::InvalidBallotIdHash)?;
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
        let mut metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;
        if metadata.state != BallotState::Active {
            return Err(ContractError::BallotExpired);
        }

        metadata.state = BallotState::Expired;
        metadata.state_updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&metadata_key, &metadata);

        env.events().publish(
            (symbol_short!("audit"), symbol_short!("exp_adm")),
            (ballot_id_hash.clone(), metadata.state_updated_at, caller),
        );
        env.events().publish(
            (symbol_short!("ballot"),),
            BallotEvent::BallotExpired(ballot_id_hash, metadata.state_updated_at),
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
        Self::require_not_paused(&env)?;
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

    // ── Admin key (BytesN<32>) rotation ────────────────────────────────────

    pub fn initialize_admin_key(
        env: Env,
        caller: Address,
        key: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        if env.storage().persistent().has(&DataKey::AdminKey) {
            return Err(ContractError::AlreadyInitialized);
        }
        if Self::is_zero_key(&key) {
            return Err(ContractError::InvalidAdminKey);
        }
        env.storage().persistent().set(&DataKey::AdminKey, &key);
        env.storage()
            .persistent()
            .set(&DataKey::KeyRotationCount, &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::LastKeyRotationTime, &0u64);
        env.events().publish(
            (symbol_short!("key"), symbol_short!("init")),
            (caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    pub fn rotate_admin_key(
        env: Env,
        caller: Address,
        new_key: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let current_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminKey)
            .ok_or(ContractError::AdminKeyNotInitialized)?;

        if Self::is_zero_key(&new_key) {
            return Err(ContractError::InvalidAdminKey);
        }
        if new_key == current_key {
            return Err(ContractError::InvalidAdminKey);
        }
        if env.storage().persistent().has(&DataKey::PendingAdminKey) {
            return Err(ContractError::KeyRotationAlreadyPending);
        }

        let now = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::PendingAdminKey, &new_key);
        env.storage()
            .persistent()
            .set(&DataKey::KeyRotationRequestedAt, &now);
        env.events().publish(
            (symbol_short!("key"), symbol_short!("rot_req")),
            (caller, now, now + KEY_ROTATION_COOLDOWN),
        );
        Ok(())
    }

    pub fn confirm_admin_key_rotation(
        env: Env,
        caller: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let pending_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdminKey)
            .ok_or(ContractError::NoKeyRotationPending)?;
        let requested_at: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::KeyRotationRequestedAt)
            .ok_or(ContractError::NoKeyRotationPending)?;

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(requested_at);
        if elapsed < KEY_ROTATION_COOLDOWN {
            return Err(ContractError::RotationTooSoon);
        }

        let _old_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminKey)
            .ok_or(ContractError::AdminKeyNotInitialized)?;

        env.storage()
            .persistent()
            .set(&DataKey::AdminKey, &pending_key);
        env.storage()
            .persistent()
            .remove(&DataKey::PendingAdminKey);
        env.storage()
            .persistent()
            .remove(&DataKey::KeyRotationRequestedAt);

        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::KeyRotationCount)
            .unwrap_or(0);
        let new_count = count.checked_add(1).ok_or(ContractError::CounterOverflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::KeyRotationCount, &new_count);
        env.storage()
            .persistent()
            .set(&DataKey::LastKeyRotationTime, &now);

        env.events().publish(
            (symbol_short!("key"), symbol_short!("rot_ok")),
            (caller, pending_key, new_count, now),
        );
        Ok(())
    }

    pub fn cancel_key_rotation(
        env: Env,
        caller: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        if !env.storage().persistent().has(&DataKey::PendingAdminKey) {
            return Err(ContractError::NoKeyRotationPending);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::PendingAdminKey);
        env.storage()
            .persistent()
            .remove(&DataKey::KeyRotationRequestedAt);

        env.events().publish(
            (symbol_short!("key"), symbol_short!("rot_cncl")),
            (caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    pub fn get_admin_key_info(env: Env) -> Result<AdminKeyInfo, ContractError> {
        let current_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminKey)
            .ok_or(ContractError::AdminKeyNotInitialized)?;

        let opt_pending: Option<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdminKey);

        let rotation_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::KeyRotationCount)
            .unwrap_or(0);

        let last_rotation_time: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastKeyRotationTime)
            .unwrap_or(0);

        let seconds_until_confirmation: u64 = if opt_pending.is_some() {
            let requested_at: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::KeyRotationRequestedAt)
                .unwrap_or(0);
            let now = env.ledger().timestamp();
            let elapsed = now.saturating_sub(requested_at);
            KEY_ROTATION_COOLDOWN.saturating_sub(elapsed)
        } else {
            0
        };

        let pending_key = match opt_pending {
            Some(k) => OptionalKey::Some(k),
            None => OptionalKey::None,
        };

        Ok(AdminKeyInfo {
            current_key,
            pending_key,
            rotation_count,
            last_rotation_time,
            seconds_until_confirmation,
        })
    }

    pub fn verify_admin_signature(
        env: Env,
        message: Bytes,
        signature: BytesN<64>,
    ) -> Result<bool, ContractError> {
        let current_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminKey)
            .ok_or(ContractError::AdminKeyNotInitialized)?;
        env.crypto()
            .ed25519_verify(&current_key, &message, &signature);
        Ok(true)
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
        let mut op: PendingOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Operation(operation_id))?;
        if op.status == OperationStatus::Pending && env.ledger().timestamp() > op.expires_at {
            op.status = OperationStatus::Expired;
        }
        if let Some(approvers) = env.storage().instance().get::<DataKey, Vec<Address>>(&DataKey::Approvers) {
            op.approval_count = Self::count_valid_approvals(&approvers, &op.approvals);
        }
        Some(op)
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

    pub fn get_ballot_created_at(env: Env, ballot_id_hash: String) -> Option<u64> {
        Self::get_ballot_metadata(env, ballot_id_hash).map(|m| m.created_at)
    }

    pub fn get_ballot_state(env: Env, ballot_id_hash: String) -> Option<BallotMetadata> {
        Self::get_ballot_metadata(env, ballot_id_hash)
    }

    pub fn is_consistent(env: Env, ballot_id_hash: String) -> bool {
        if !Self::ballot_exists(env.clone(), ballot_id_hash.clone()) {
            return false;
        }
        let tokens = Self::get_tokens_issued(env.clone(), ballot_id_hash.clone()).unwrap_or(0);
        let votes = Self::get_votes_cast(env.clone(), ballot_id_hash).unwrap_or(0);
        tokens == votes
    }

    pub fn get_audit_report(env: Env, ballot_id_hash: String) -> Option<BallotAuditReport> {
        let meta = Self::get_ballot_metadata(env.clone(), ballot_id_hash.clone())?;
        let tokens = Self::get_tokens_issued(env.clone(), ballot_id_hash.clone()).unwrap_or(0);
        let votes = Self::get_votes_cast(env.clone(), ballot_id_hash.clone()).unwrap_or(0);
        let result_hash = Self::get_result_hash(env.clone(), ballot_id_hash);
        let is_consistent = tokens == votes;

        Some(BallotAuditReport {
            admin: meta.admin,
            created_at: meta.created_at,
            expiration_time: meta.expiration_time,
            is_consistent,
            result_hash,
            state: meta.state,
            tokens_issued: tokens,
            votes_cast: votes,
        })
    }

    pub fn verify_result_proof(
        env: Env,
        ballot_id_hash: String,
        vote_merkle_proof: MerkleProof,
        result_hash: String,
    ) -> Result<bool, ContractError> {
        if !Self::ballot_exists(env.clone(), ballot_id_hash.clone()) {
            return Err(ContractError::BallotNotFound);
        }
        let result_key = DataKey::ResultHash(ballot_id_hash.clone());
        if !env.storage().persistent().has(&result_key) {
            return Err(ContractError::BallotNotFound);
        }
        let stored_result_hash: String = env.storage().persistent().get(&result_key).ok_or(ContractError::InternalError)?;

        let mut current_hash = vote_merkle_proof.vote_hash;
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

    fn validate_approvers_and_threshold(
        approvers: &Vec<Address>,
        threshold: u32,
    ) -> Result<(), ContractError> {
        let n = approvers.len() as u32;
        if n < MIN_APPROVERS || n > MAX_APPROVERS {
            return Err(ContractError::InvalidApprovalConfig);
        }
        if threshold < MIN_APPROVERS || threshold > n {
            return Err(ContractError::InvalidApprovalConfig);
        }
        let mut seen = Vec::new(approvers.env());
        for approver in approvers.iter() {
            if Self::contains_address(&seen, &approver) {
                return Err(ContractError::DuplicateApprover);
            }
            seen.push_back(approver);
        }
        Ok(())
    }

    fn count_valid_approvals(approvers: &Vec<Address>, approvals: &Vec<Address>) -> u32 {
        let mut count = 0u32;
        for approver in approvals.iter() {
            if Self::contains_address(approvers, &approver) {
                count += 1;
            }
        }
        count
    }

    fn update_approver_activity(env: &Env, approver: &Address) -> Result<(), ContractError> {
        let key = DataKey::ApproverActivity(approver.clone());
        let mut activity: ApproverActivity = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(ApproverActivity {
                approval_count: 0,
                last_active: 0,
            });
        activity.approval_count = activity.approval_count.saturating_add(1);
        activity.last_active = env.ledger().timestamp();
        env.storage().persistent().set(&key, &activity);
        Ok(())
    }

    fn validate_operation(env: &Env, operation: &OperationType) -> Result<(), ContractError> {
        match operation {
            OperationType::ResultPublication(ballot_id_hash, result_hash) => {
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
            OperationType::UpgradeContract(_) => {
                if env.storage().instance().has(&DataKey::PendingUpgrade) {
                    return Err(ContractError::UpgradeAlreadyScheduled);
                }
            }
            OperationType::AdminRotation(new_admin) => {
                let current_admin: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Admin)
                    .ok_or(ContractError::NotInitialized)?;
                if current_admin == *new_admin {
                    return Err(ContractError::SameAdmin);
                }
            }
            OperationType::ChangeThreshold(new_threshold) => {
                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                Self::validate_approvers_and_threshold(&approvers, *new_threshold)?;
            }
            OperationType::AddApprover(new_approver) => {
                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                if Self::contains_address(&approvers, new_approver) {
                    return Err(ContractError::DuplicateApprover);
                }
                if (approvers.len() as u32) >= MAX_APPROVERS {
                    return Err(ContractError::InvalidApprovalConfig);
                }
            }
            OperationType::RemoveApprover(target_approver) => {
                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                if !Self::contains_address(&approvers, target_approver) {
                    return Err(ContractError::ApproverUnauthorized);
                }
                let new_len = (approvers.len() as u32).saturating_sub(1);
                let threshold: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::ApprovalThreshold)
                    .unwrap_or(2);
                if new_len < MIN_APPROVERS || threshold > new_len {
                    return Err(ContractError::InvalidApprovalConfig);
                }
            }
            OperationType::PauseContract | OperationType::UnpauseContract => {}
        }
        Ok(())
    }

    fn execute_operation_internal(env: &Env, pending: &mut PendingOperation) -> Result<(), ContractError> {
        match &pending.operation {
            OperationType::AdminRotation(new_admin) => {
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

                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .unwrap_or(Vec::new(env));
                let mut updated_approvers = approvers.clone();
                let mut approvers_changed = false;
                for i in 0..updated_approvers.len() {
                    if updated_approvers.get(i).unwrap() == old_admin {
                        updated_approvers.set(i, new_admin.clone());
                        approvers_changed = true;
                    }
                }
                if approvers_changed {
                    env.storage()
                        .instance()
                        .set(&DataKey::Approvers, &updated_approvers);
                }

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
            OperationType::ResultPublication(ballot_id_hash, result_hash) => {
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
                env.events().publish(
                    (symbol_short!("ballot"),),
                    BallotEvent::ResultPublished(ballot_id_hash.clone(), result_hash.clone()),
                );
            }
            OperationType::PauseContract => {
                env.storage().instance().set(&DataKey::IsPaused, &true);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("paused")),
                    env.ledger().timestamp(),
                );
            }
            OperationType::UnpauseContract => {
                env.storage().instance().set(&DataKey::IsPaused, &false);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("resumed")),
                    (pending.proposer.clone(), env.ledger().timestamp()),
                );
            }
            OperationType::ChangeThreshold(new_threshold) => {
                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                Self::validate_approvers_and_threshold(&approvers, *new_threshold)?;
                env.storage()
                    .instance()
                    .set(&DataKey::ApprovalThreshold, new_threshold);
                env.events().publish(
                    (symbol_short!("govern"), symbol_short!("cfg_appr")),
                    (pending.proposer.clone(), *new_threshold, approvers.len() as u32),
                );
            }
            OperationType::AddApprover(new_approver) => {
                let mut approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                if Self::contains_address(&approvers, new_approver) {
                    return Err(ContractError::DuplicateApprover);
                }
                approvers.push_back(new_approver.clone());
                let threshold: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::ApprovalThreshold)
                    .unwrap_or(2);
                Self::validate_approvers_and_threshold(&approvers, threshold)?;
                env.storage().instance().set(&DataKey::Approvers, &approvers);
                env.events().publish(
                    (symbol_short!("govern"), symbol_short!("appr_add")),
                    (pending.proposer.clone(), new_approver.clone()),
                );
            }
            OperationType::RemoveApprover(target_approver) => {
                let approvers: Vec<Address> = env
                    .storage()
                    .instance()
                    .get(&DataKey::Approvers)
                    .ok_or(ContractError::NotInitialized)?;
                let mut new_approvers = Vec::new(env);
                for a in approvers.iter() {
                    if a != *target_approver {
                        new_approvers.push_back(a);
                    }
                }
                let threshold: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::ApprovalThreshold)
                    .unwrap_or(2);
                Self::validate_approvers_and_threshold(&new_approvers, threshold)?;
                env.storage()
                    .instance()
                    .set(&DataKey::Approvers, &new_approvers);
                env.events().publish(
                    (symbol_short!("govern"), symbol_short!("appr_rmv")),
                    (pending.proposer.clone(), target_approver.clone()),
                );
            }
            OperationType::UpgradeContract(new_wasm_hash) => {
                if env.storage().instance().has(&DataKey::PendingUpgrade) {
                    return Err(ContractError::UpgradeAlreadyScheduled);
                }
                let now = env.ledger().timestamp();
                let upgrade = PendingUpgrade {
                    executable_at: now + UPGRADE_TIME_LOCK_SECONDS,
                    new_wasm_hash: new_wasm_hash.clone(),
                    scheduled_at: now,
                };
                env.storage()
                    .instance()
                    .set(&DataKey::PendingUpgrade, &upgrade);
                env.events().publish(
                    (symbol_short!("audit"), symbol_short!("upg_schd")),
                    (
                        new_wasm_hash.clone(),
                        upgrade.scheduled_at,
                        upgrade.executable_at,
                    ),
                );
            }
        }

        pending.status = OperationStatus::Executed;
        let now = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("govern"), symbol_short!("op_exec")),
            (pending.id, now),
        );
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
            .map(|threshold| threshold > 0 && threshold <= (approvers.len() as u32))
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
        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .ok_or(ContractError::AdminUnauthorized)?;
        if !Self::contains_address(&approvers, caller) {
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
        let key = DataKey::BallotMetadata(ballot_id_hash.clone());
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::BallotNotFound)
    }

    fn require_ballot_metadata_and_not_expired(
        env: &Env,
        ballot_id_hash: &String,
    ) -> Result<BallotMetadata, ContractError> {
        let metadata = Self::require_ballot_metadata(env, ballot_id_hash)?;
        if metadata.state == BallotState::Expired {
            return Err(ContractError::BallotExpired);
        }
        Ok(metadata)
    }

    fn is_zero_key(key: &BytesN<32>) -> bool {
        let arr = key.to_array();
        arr.iter().all(|&b| b == 0)
    }
}

fn is_valid_sha256_hex(s: &String) -> bool {
    if s.len() != 64 {
        return false;
    }
    let mut buf = [0u8; 64];
    s.copy_into_slice(&mut buf);
    let mut i = 0usize;
    while i < 64 {
        let b = buf[i];
        let valid = (b >= b'0' && b <= b'9') || (b >= b'a' && b <= b'f');
        if !valid {
            return false;
        }
        i += 1;
    }
    true
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
    let rust_str = unsafe { core::str::from_utf8_unchecked(&buf) };
    String::from_str(env, rust_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    const BALLOT_A: &str = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const BALLOT_B: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const BALLOT_C: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const BALLOT_G: &str = "6666666666666666666666666666666666666666666666666666666666666666";
    const RESULT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn setup() -> (Env, AnonVoteContractClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let a1 = Address::generate(&env);
        let a2 = Address::generate(&env);
        let a3 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1.clone(), a2.clone(), a3.clone()]);
        client.initialize(&approvers, &2);
        (env, client, a1, a2, a3)
    }

    fn limits(max_tokens: u32, max_votes: u32) -> BallotLimits {
        BallotLimits {
            max_tokens,
            max_votes,
        }
    }

    fn setup_uninitialized() -> (Env, AnonVoteContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        (env, client, admin, contract_id)
    }

    // ── Phase 1 & 2 Multi-Sig & Parameter Guard Unit Tests ─────────────────

    #[test]
    fn test_initialize_valid_multisig() {
        let (_env, client, a1, a2, a3) = setup();
        assert_eq!(client.get_approval_threshold(), 2);
        let approvers = client.get_approvers();
        assert_eq!(approvers.len(), 3);
        assert_eq!(approvers.get(0).unwrap(), a1);
        assert_eq!(approvers.get(1).unwrap(), a2);
        assert_eq!(approvers.get(2).unwrap(), a3);
    }

    #[test]
    fn test_initialize_invalid_threshold_below_min() {
        let (env, client, _, _) = setup_uninitialized();
        let a1 = Address::generate(&env);
        let a2 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1, a2]);
        assert_eq!(
            client.try_initialize(&approvers, &1),
            Err(Ok(ContractError::InvalidApprovalConfig))
        );
    }

    #[test]
    fn test_initialize_invalid_threshold_exceeds_approvers() {
        let (env, client, _, _) = setup_uninitialized();
        let a1 = Address::generate(&env);
        let a2 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1, a2]);
        assert_eq!(
            client.try_initialize(&approvers, &3),
            Err(Ok(ContractError::InvalidApprovalConfig))
        );
    }

    #[test]
    fn test_initialize_max_approvers_exceeded() {
        let (env, client, _, _) = setup_uninitialized();
        let mut approvers = Vec::new(&env);
        for _ in 0..11 {
            approvers.push_back(Address::generate(&env));
        }
        assert_eq!(
            client.try_initialize(&approvers, &5),
            Err(Ok(ContractError::InvalidApprovalConfig))
        );
    }

    #[test]
    fn test_initialize_duplicate_approver() {
        let (env, client, _, _) = setup_uninitialized();
        let a1 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1.clone(), a1]);
        assert_eq!(
            client.try_initialize(&approvers, &2),
            Err(Ok(ContractError::DuplicateApprover))
        );
    }

    #[test]
    fn test_propose_operation_success() {
        let (_env, client, a1, _, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        assert_eq!(op_id, 0);

        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.proposer, a1);
        assert_eq!(op.status, OperationStatus::Pending);
        assert_eq!(op.approval_count, 1);
        assert_eq!(op.threshold, 2);
    }

    #[test]
    fn test_propose_operation_unauthorized_proposer() {
        let (env, client, _, _, _) = setup();
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_propose_operation(&outsider, &OperationType::PauseContract),
            Err(Ok(ContractError::ApproverUnauthorized))
        );
    }

    #[test]
    fn test_approve_operation_threshold_reached() {
        let (_env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let executed = client.approve_operation(&op_id, &a2);
        assert!(!executed);

        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.approval_count, 2);
        assert_eq!(op.status, OperationStatus::Pending);
    }

    #[test]
    fn test_approve_operation_duplicate_approval_rejected() {
        let (_env, client, a1, _, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        assert_eq!(
            client.try_approve_operation(&op_id, &a1),
            Err(Ok(ContractError::OperationAlreadyApproved))
        );
    }

    #[test]
    fn test_approve_operation_unauthorized_approver() {
        let (env, client, a1, _, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_approve_operation(&op_id, &outsider),
            Err(Ok(ContractError::ApproverUnauthorized))
        );
    }

    #[test]
    fn test_time_lock_enforcement_prevents_early_execution() {
        let (_env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        client.approve_operation(&op_id, &a2);

        assert_eq!(
            client.try_execute_operation(&a1, &op_id),
            Err(Ok(ContractError::TimeLockNotExpired))
        );
        assert!(!client.is_paused());
    }

    #[test]
    fn test_execute_operation_after_time_lock() {
        let (env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        client.approve_operation(&op_id, &a2);

        env.ledger().with_mut(|l| l.timestamp += UPGRADE_TIME_LOCK_SECONDS + 1);

        client.execute_operation(&a1, &op_id);
        assert!(client.is_paused());
        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.status, OperationStatus::Executed);
    }

    #[test]
    fn test_emergency_execute_bypasses_time_lock() {
        let (_env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        client.approve_operation(&op_id, &a2);

        client.emergency_execute(&a1, &op_id);
        assert!(client.is_paused());
        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.status, OperationStatus::Executed);
    }

    #[test]
    fn test_cancel_operation_during_time_lock() {
        let (_env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        client.cancel_operation(&a2, &op_id);
        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.status, OperationStatus::Cancelled);

        assert_eq!(
            client.try_approve_operation(&op_id, &a2),
            Err(Ok(ContractError::OperationNotPending))
        );
    }

    #[test]
    fn test_reject_operation_majority_rejects() {
        let (env, client, a1, a2, a3) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let reason = String::from_str(&env, "risk to election");
        client.reject_operation(&a2, &op_id, &reason);
        assert_eq!(client.get_operation(&op_id).unwrap().status, OperationStatus::Pending);

        client.reject_operation(&a3, &op_id, &reason);
        assert_eq!(client.get_operation(&op_id).unwrap().status, OperationStatus::Rejected);
    }

    #[test]
    fn test_rejection_cooldown_prevents_immediate_resubmission() {
        let (env, client, a1, a2, a3) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let reason = String::from_str(&env, "rejected");
        client.reject_operation(&a2, &op_id, &reason);
        client.reject_operation(&a3, &op_id, &reason);

        assert_eq!(
            client.try_propose_operation(&a1, &OperationType::PauseContract),
            Err(Ok(ContractError::CooldownActive))
        );
    }

    #[test]
    fn test_rejection_cooldown_expires_after_24_hours() {
        let (env, client, a1, a2, a3) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let reason = String::from_str(&env, "rejected");
        client.reject_operation(&a2, &op_id, &reason);
        client.reject_operation(&a3, &op_id, &reason);

        env.ledger().with_mut(|l| l.timestamp += KEY_ROTATION_COOLDOWN + 1);

        let new_op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        assert_eq!(new_op_id, 1);
    }

    #[test]
    fn test_operation_expiry_after_30_days() {
        let (env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        env.ledger().with_mut(|l| l.timestamp += APPROVAL_EXPIRATION_SECONDS + 1);

        assert_eq!(
            client.try_approve_operation(&op_id, &a2),
            Err(Ok(ContractError::OperationExpired))
        );
        let op = client.get_operation(&op_id).unwrap();
        assert_eq!(op.status, OperationStatus::Expired);
    }

    #[test]
    fn test_change_threshold_via_multisig() {
        let (_env, client, a1, a2, _) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::ChangeThreshold(3));
        client.approve_operation(&op_id, &a2);
        client.emergency_execute(&a1, &op_id);

        assert_eq!(client.get_approval_threshold(), 3);
    }

    #[test]
    fn test_add_approver_via_multisig() {
        let (env, client, a1, a2, _) = setup();
        let a4 = Address::generate(&env);
        let op_id = client.propose_operation(&a1, &OperationType::AddApprover(a4.clone()));
        client.approve_operation(&op_id, &a2);
        client.emergency_execute(&a1, &op_id);

        let approvers = client.get_approvers();
        assert_eq!(approvers.len(), 4);
        assert_eq!(approvers.get(3).unwrap(), a4);
    }

    #[test]
    fn test_remove_approver_via_multisig() {
        let (_env, client, a1, a2, a3) = setup();
        let op_id = client.propose_operation(&a1, &OperationType::RemoveApprover(a3.clone()));
        client.approve_operation(&op_id, &a2);
        client.emergency_execute(&a1, &op_id);

        let approvers = client.get_approvers();
        assert_eq!(approvers.len(), 2);
    }

    #[test]
    fn test_approver_activity_tracking() {
        let (env, client, a1, a2, _) = setup();
        env.ledger().with_mut(|l| l.timestamp = 1000);
        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);

        let act1 = client.get_approver_activity(&a1).unwrap();
        assert_eq!(act1.approval_count, 1);
        assert_eq!(act1.last_active, 1000);

        client.approve_operation(&op_id, &a2);
        let act2 = client.get_approver_activity(&a2).unwrap();
        assert_eq!(act2.approval_count, 1);
        assert_eq!(act2.last_active, 1000);
    }

    #[test]
    fn test_3_of_5_threshold_workflow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);

        let a1 = Address::generate(&env);
        let a2 = Address::generate(&env);
        let a3 = Address::generate(&env);
        let a4 = Address::generate(&env);
        let a5 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1.clone(), a2.clone(), a3.clone(), a4.clone(), a5.clone()]);
        client.initialize(&approvers, &3);

        let op_id = client.propose_operation(&a1, &OperationType::PauseContract);
        assert_eq!(client.get_operation(&op_id).unwrap().approval_count, 1);

        client.approve_operation(&op_id, &a2);
        assert_eq!(client.get_operation(&op_id).unwrap().approval_count, 2);

        client.approve_operation(&op_id, &a3);
        assert_eq!(client.get_operation(&op_id).unwrap().approval_count, 3);

        client.emergency_execute(&a1, &op_id);
        assert!(client.is_paused());
    }

    #[test]
    fn test_edge_case_remove_approver_violates_threshold() {
        let (_env, client, a1, a2, a3) = setup();
        let op_th = client.propose_operation(&a1, &OperationType::ChangeThreshold(3));
        client.approve_operation(&op_th, &a2);
        client.emergency_execute(&a1, &op_th);

        assert_eq!(
            client.try_propose_operation(&a1, &OperationType::RemoveApprover(a3.clone())),
            Err(Ok(ContractError::InvalidApprovalConfig))
        );
    }

    // ── Original Contract Unit Tests ───────────────────────────────────────

    #[test]
    fn contract_is_valid_after_initialization() {
        let (env, client, a1, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&a1, &ballot, &limits(10, 10));
        assert_eq!(client.get_admin(), Some(a1));
        assert_eq!(client.get_tokens_issued(&ballot), Some(0));
    }

    #[test]
    fn get_version_returns_contract_cargo_version() {
        let (env, client, _, _, _) = setup();
        assert_eq!(client.get_version(), String::from_str(&env, env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn write_operations_reject_uninitialized_contract() {
        let (env, client, admin, _) = setup_uninitialized();
        let ballot = String::from_str(&env, BALLOT_A);

        assert_eq!(
            client.try_record_ballot(&admin, &ballot, &limits(1, 1)),
            Err(Ok(ContractError::NotInitialized))
        );
    }

    #[test]
    fn batch_records_all_ballots_and_returns_hashes() {
        let (env, client, a1, _, _) = setup();
        let id_a = String::from_str(&env, BALLOT_A);
        let id_b = String::from_str(&env, BALLOT_B);
        let id_c = String::from_str(&env, BALLOT_C);

        let ballots = Vec::from_array(
            &env,
            [
                (id_a.clone(), limits(10, 10)),
                (id_b.clone(), limits(20, 20)),
                (id_c.clone(), limits(30, 30)),
            ],
        );

        let recorded = client.record_ballots_batch(&a1, &ballots);
        assert_eq!(recorded.len(), 3);

        for id in [&id_a, &id_b, &id_c] {
            assert!(client.ballot_exists(id));
            assert_eq!(client.get_tokens_issued(id), Some(0));
            assert_eq!(client.get_votes_cast(id), Some(0));
        }
    }

    #[test]
    fn happy_path_record_ballot_then_token_vote_result_all_succeed() {
        let (env, client, a1, a2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_G);
        let result = String::from_str(&env, RESULT_A);

        client.record_ballot(&a1, &ballot, &limits(10, 10));

        client.record_token(&a1, &ballot);
        client.record_vote(&a1, &ballot);

        assert_eq!(client.get_tokens_issued(&ballot), Some(1));
        assert_eq!(client.get_votes_cast(&ballot), Some(1));
        assert!(client.is_consistent(&ballot));

        let op_id = client.record_result(&a1, &ballot, &result);
        client.approve_operation(&op_id, &a2);
        client.emergency_execute(&a1, &op_id);
        assert_eq!(client.get_result_hash(&ballot), Some(result));
    }

    #[test]
    fn pause_enforcement_blocks_operations() {
        let (env, client, a1, a2, _) = setup();
        
        let ballot = String::from_str(&env, BALLOT_A);
        let _result = String::from_str(&env, RESULT_A);
        
        let op_id = client.pause_contract(&a1);
        client.approve_operation(&op_id, &a2);
        client.emergency_execute(&a1, &op_id);
        assert_eq!(client.is_paused(), true);
        
        assert_eq!(
            client.try_record_ballot(&a1, &ballot, &limits(10, 10)),
            Err(Ok(ContractError::ContractPaused))
        );
        
        let op_unpause = client.unpause_contract(&a1);
        client.approve_operation(&op_unpause, &a2);
        client.emergency_execute(&a1, &op_unpause);
        assert_eq!(client.is_paused(), false);
        
        client.record_ballot(&a1, &ballot, &limits(10, 10));
        client.record_token(&a1, &ballot);
        client.record_vote(&a1, &ballot);
    }

    #[test]
    fn test_remove_approver_invalidates_past_approvals() {
        let (env, client, a1, a2, a3) = setup();
        let a4 = Address::generate(&env);

        let op_add = client.propose_operation(&a1, &OperationType::AddApprover(a4.clone()));
        client.approve_operation(&op_add, &a2);
        client.emergency_execute(&a1, &op_add);

        let op_thresh = client.propose_operation(&a1, &OperationType::ChangeThreshold(3));
        client.approve_operation(&op_thresh, &a2);
        client.emergency_execute(&a1, &op_thresh);

        assert_eq!(client.get_approval_threshold(), 3);
        assert_eq!(client.get_approvers().len(), 4);

        let op_pause = client.propose_operation(&a1, &OperationType::PauseContract);
        client.approve_operation(&op_pause, &a4);

        assert_eq!(client.get_operation(&op_pause).unwrap().approval_count, 2);

        let op_rm = client.propose_operation(&a1, &OperationType::RemoveApprover(a4.clone()));
        client.approve_operation(&op_rm, &a2);
        client.approve_operation(&op_rm, &a3);
        client.emergency_execute(&a1, &op_rm);

        assert_eq!(client.get_approvers().len(), 3);

        assert_eq!(client.get_operation(&op_pause).unwrap().approval_count, 1);

        client.approve_operation(&op_pause, &a2);
        assert_eq!(client.get_operation(&op_pause).unwrap().approval_count, 2);
        assert_eq!(
            client.try_emergency_execute(&a1, &op_pause),
            Err(Ok(ContractError::ThresholdNotMet))
        );

        client.approve_operation(&op_pause, &a3);
        assert_eq!(client.get_operation(&op_pause).unwrap().approval_count, 3);
        client.emergency_execute(&a1, &op_pause);
        assert_eq!(client.is_paused(), true);
    }
}
