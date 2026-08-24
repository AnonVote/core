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
const ADMIN_ROTATION_TIME_LOCK: u64 = 7 * 24 * 60 * 60; // 7 days
const ADMIN_INACTIVITY_THRESHOLD: u64 = 365 * 24 * 60 * 60; // 365 days

// ── Contract limits (issue #105) ────────────────────────────────────────────
// These caps keep storage bounded, tally computation fast, and the u32
// counters free of overflow. Each limit is enforced on-chain where possible;
// limits that only constrain the off-chain ballot content are still published
// here (and via `get_contract_limits`) so callers can discover them.

// Max options per ballot: beyond 100, the UI and tally become unwieldy.
// Options live in the off-chain ballot content addressed by ballot_id_hash,
// so this bound is enforced by the backend that constructs ballots.
const MAX_OPTIONS_PER_BALLOT: u32 = 100;

// Max voters (tokens issued) per ballot: bounds token issuance work and
// per-ballot storage. Enforced on-chain via `BallotLimits.max_tokens`.
const MAX_VOTERS_PER_BALLOT: u32 = 100_000;

// Max votes per ballot: keeps tally computation fast and guarantees the u32
// vote counter can never reach its overflow boundary. Enforced on-chain via
// `BallotLimits.max_votes`.
const MAX_VOTES_PER_BALLOT: u32 = 1_000_000;

// Max ballots the contract will ever record: prevents unbounded storage
// growth. Enforced on-chain by a running total ballot counter.
const MAX_BALLOTS: u32 = 10_000;

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
    AdminKeyNotInitialized = 31,
    // Merkle / cross-contract verification errors
    MerkleRootAlreadySet = 32,
    InvalidResultCommitment = 34,
    ResultCommitmentAlreadySet = 35,
    // Governance errors
    CooldownActive = 39,
    ThresholdNotMet = 41,
    // Admin address rotation errors (issue #125)
    RotationAlreadyPending = 42,
    NoRotationPending = 43,
    AddressRotationTooSoon = 44,
    InvalidRecoveryKey = 45,
    RecoveryKeyConsumed = 46,
    NoSuccessorSet = 49,
    AdminStillActive = 50,
    NotSuccessor = 51,
    // Ballot state machine errors (4-state lifecycle)
    InvalidStateTransition = 52,
    BallotNotInVotingState = 53,
    BallotNotInClosedState = 54,
    // Counter overflow & ballot limit errors (issue #105)
    //
    // NOTE: `TooManyOptions` and `InvalidOptionIndex` from the issue are
    // intentionally not defined here — options live in the off-chain ballot
    // content addressed by `ballot_id_hash` and are never passed to the
    // contract, so those errors can never be produced on-chain. The
    // `MAX_OPTIONS_PER_BALLOT` bound is still published via
    // `get_contract_limits()` for backend enforcement.
    VoteCounterOverflow = 55,
    TooManyVoters = 56,
    BallotFull = 57,
    EmptyOptions = 58,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BallotState {
    Created,
    Voting,
    Closed,
    Tallied,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BallotLimits {
    pub max_tokens: u32,
    pub max_votes: u32,
}

/// Contract-wide limits exposed by `get_contract_limits` (issue #105).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractLimits {
    pub max_options_per_ballot: u32,
    pub max_voters_per_ballot: u32,
    pub max_votes_per_ballot: u32,
    pub max_ballots: u32,
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

/// Pending admin address rotation proposal (issue #125).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRotationProposal {
    pub new_admin: Address,
    pub proposed_at: u64,
    pub execute_after: u64,
}

/// Permissions that can be delegated to a non-admin address (issue #125).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DelegatedPermission {
    PauseContract,
    ChangeThreshold,
    RotateKey,
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

/// Result of a batch Merkle proof verification.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchVerificationResult {
    pub total_proofs: u32,
    pub verified: u32,
    pub failed: u32,
    pub results: Vec<bool>,
}

/// Record of a cross-contract verification call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CrossContractCallRecord {
    pub ballot_id_hash: String,
    pub contract_address: String,
    pub method: String,
    pub result: bool,
    pub timestamp: u64,
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
    BallotExpired(String),
    PendingUpgrade,
    RotationHistory,
    // Admin key (BytesN<32>) rotation state
    AdminKey,
    PendingAdminKey,
    KeyRotationRequestedAt,
    KeyRotationCount,
    LastKeyRotationTime,
    // Merkle / cross-contract verification
    MerkleRoot(String),
    ResultCommitment(String),
    CrossContractRecord(String),
    ApproverActivity(Address),
    RejectionCooldown(OperationType),
    // Admin address rotation with time-lock (issue #125)
    PendingAdminAddress,
    AdminAddressRotationRequestedAt,
    RecoveryKeyHash,
    RecoveryKeyUsed,
    // Delegation (issue #125)
    Delegation(Address, DelegatedPermission),
    // Successor / emergency contact (issue #125)
    Successor,
    SuccessorSetAt,
    LastAdminActivity,
    EmergencyContact,
    // Running total of ballots recorded (issue #105)
    BallotCount,
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    /// Returns the semantic version of this contract package.
    pub fn get_version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Returns the contract-wide limits (issue #105).
    ///
    /// Every ballot's `BallotLimits` must respect these caps; ballots that
    /// exceed them are rejected at creation time.
    pub fn get_contract_limits(_env: Env) -> ContractLimits {
        ContractLimits {
            max_options_per_ballot: MAX_OPTIONS_PER_BALLOT,
            max_voters_per_ballot: MAX_VOTERS_PER_BALLOT,
            max_votes_per_ballot: MAX_VOTES_PER_BALLOT,
            max_ballots: MAX_BALLOTS,
        }
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
        env.storage()
            .persistent()
            .set(&DataKey::LastAdminActivity, &env.ledger().timestamp());
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

        // Reject batches larger than the contract-wide ballot cap up front
        // so a single transaction can never grow storage unboundedly.
        if (ballots.len() as u32) > MAX_BALLOTS {
            return Err(ContractError::LimitExceeded);
        }

        // Validate every entry before writing any — all-or-nothing semantics.
        for i in 0..ballots.len() {
            let (ballot_id_hash, limits) = ballots.get(i).unwrap();
            if !is_valid_sha256_hex(&ballot_id_hash) {
                return Err(ContractError::InvalidBallotIdHash);
            }
            Self::validate_ballot_limits(&limits)?;
            let key = DataKey::BallotMetadata(ballot_id_hash.clone());
            if env.storage().persistent().has(&key) {
                return Err(ContractError::BallotAlreadyExists);
            }
        }

        // Enforce the contract-wide maximum number of ballots.
        let ballot_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BallotCount)
            .unwrap_or(0);
        let new_total = ballot_count
            .checked_add(ballots.len() as u32)
            .ok_or(ContractError::CounterOverflow)?;
        if new_total > MAX_BALLOTS {
            return Err(ContractError::LimitExceeded);
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
                state: BallotState::Created,
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

        env.storage()
            .instance()
            .set(&DataKey::BallotCount, &new_total);

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
        Self::validate_ballot_limits(&limits)?;

        let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
        if env.storage().persistent().has(&metadata_key) {
            return Err(ContractError::BallotAlreadyExists);
        }

        // Enforce the contract-wide maximum number of ballots.
        let ballot_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BallotCount)
            .unwrap_or(0);
        let new_total = ballot_count
            .checked_add(1)
            .ok_or(ContractError::CounterOverflow)?;
        if new_total > MAX_BALLOTS {
            return Err(ContractError::LimitExceeded);
        }

        let now = env.ledger().timestamp();
        let metadata = BallotMetadata {
            admin: caller.clone(),
            created_at: now,
            expiration_time: 0,
            limits,
            state: BallotState::Created,
            state_updated_at: now,
        };
        env.storage().persistent().set(&metadata_key, &metadata);

        let tokens_key = DataKey::TokensIssued(ballot_id_hash.clone());
        let votes_key = DataKey::VotesCast(ballot_id_hash.clone());
        env.storage().persistent().set(&tokens_key, &0u32);
        env.storage().persistent().set(&votes_key, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::BallotCount, &new_total);
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

    /// Transitions a ballot from Created to Voting state.
    ///
    /// Only the admin can start voting. Once started, tokens and votes can be recorded.
    /// Cannot transition if the ballot is already in Voting, Closed, or Tallied state.
    pub fn start_voting(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        validate_hex_hash(&env, &ballot_id_hash, ContractError::InvalidBallotIdHash)?;
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
        let mut metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        if metadata.state != BallotState::Created {
            return Err(ContractError::InvalidStateTransition);
        }

        metadata.state = BallotState::Voting;
        metadata.state_updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&metadata_key, &metadata);

        env.events().publish(
            (symbol_short!("ballot"), symbol_short!("voting")),
            (ballot_id_hash, metadata.state_updated_at, caller),
        );
        Ok(())
    }

    /// Transitions a ballot from Voting to Closed state.
    ///
    /// Only the admin can close voting. Once closed, no more tokens or votes can be recorded,
    /// but the result can be tallied.
    /// Cannot transition if the ballot is not in Voting state.
    pub fn close_voting(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
    ) -> Result<(), ContractError> {
        validate_hex_hash(&env, &ballot_id_hash, ContractError::InvalidBallotIdHash)?;
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
        let mut metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        if metadata.state != BallotState::Voting {
            return Err(ContractError::InvalidStateTransition);
        }

        metadata.state = BallotState::Closed;
        metadata.state_updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&metadata_key, &metadata);

        env.events().publish(
            (symbol_short!("ballot"), symbol_short!("closed")),
            (ballot_id_hash, metadata.state_updated_at, caller),
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
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        if metadata.state != BallotState::Voting {
            return Err(ContractError::BallotNotInVotingState);
        }

        let key = DataKey::TokensIssued(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        // Reject once the ballot's voter (token) cap is reached.
        if count >= metadata.limits.max_tokens {
            return Err(ContractError::TooManyVoters);
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
        let metadata = Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        if metadata.state != BallotState::Voting {
            return Err(ContractError::BallotNotInVotingState);
        }

        let key = DataKey::VotesCast(ballot_id_hash.clone());
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        // Reject once the ballot's vote cap is reached (issue #105).
        if count >= metadata.limits.max_votes {
            return Err(ContractError::BallotFull);
        }
        // checked_add: the u32 vote counter can never silently wrap. With
        // MAX_VOTES_PER_BALLOT enforced at creation this is unreachable in
        // practice, but the guard remains as defense in depth.
        let new_count = count
            .checked_add(1)
            .ok_or(ContractError::VoteCounterOverflow)?;
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
        
        if metadata.state != BallotState::Voting {
            return Err(ContractError::BallotExpired);
        }

        metadata.state = BallotState::Closed;
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

    // ── Admin address rotation with time-lock (issue #125) ─────────────────

    /// Proposes replacement of the admin address. Enforces a 7-day time lock
    /// before the new address can take effect, giving observers a window to
    /// react if the proposal was made under duress.
    pub fn admin_propose_rotation(
        env: Env,
        caller: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if new_admin == current_admin {
            return Err(ContractError::SameAdmin);
        }
        if env.storage().persistent().has(&DataKey::PendingAdminAddress) {
            return Err(ContractError::RotationAlreadyPending);
        }

        let now = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::PendingAdminAddress, &new_admin);
        env.storage()
            .persistent()
            .set(&DataKey::AdminAddressRotationRequestedAt, &now);
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("rot_prp")),
            (caller, new_admin, now, now + ADMIN_ROTATION_TIME_LOCK),
        );
        Ok(())
    }

    /// Executes a pending admin address rotation once the 7-day time lock has
    /// expired. Anyone can call this; the time lock itself is the guard.
    pub fn execute_admin_rotation(env: Env) -> Result<(), ContractError> {
        let new_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdminAddress)
            .ok_or(ContractError::NoRotationPending)?;
        let proposed_at: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AdminAddressRotationRequestedAt)
            .ok_or(ContractError::NoRotationPending)?;

        let now = env.ledger().timestamp();
        if now.saturating_sub(proposed_at) < ADMIN_ROTATION_TIME_LOCK {
            return Err(ContractError::AddressRotationTooSoon);
        }

        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        let mut history: Vec<RotationRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::RotationHistory)
            .unwrap_or(Vec::new(&env));
        history.push_back(RotationRecord {
            old_admin: old_admin.clone(),
            new_admin: new_admin.clone(),
            rotated_at: now,
        });
        env.storage()
            .persistent()
            .set(&DataKey::RotationHistory, &history);
        env.storage()
            .persistent()
            .remove(&DataKey::PendingAdminAddress);
        env.storage()
            .persistent()
            .remove(&DataKey::AdminAddressRotationRequestedAt);
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("rot_ok")),
            (old_admin, new_admin, now),
        );
        Ok(())
    }

    /// Cancels a pending admin address rotation during the time-lock window.
    /// Only the current admin can cancel.
    pub fn cancel_admin_rotation(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;

        if !env.storage().persistent().has(&DataKey::PendingAdminAddress) {
            return Err(ContractError::NoRotationPending);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::PendingAdminAddress);
        env.storage()
            .persistent()
            .remove(&DataKey::AdminAddressRotationRequestedAt);

        let now = env.ledger().timestamp();
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("rot_cncl")),
            (caller, now),
        );
        Ok(())
    }

    /// Returns the pending admin rotation proposal, if one exists.
    pub fn get_pending_admin_rotation(env: Env) -> Option<AdminRotationProposal> {
        let new_admin: Option<Address> =
            env.storage().persistent().get(&DataKey::PendingAdminAddress);
        let proposed_at: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminAddressRotationRequestedAt);
        match (new_admin, proposed_at) {
            (Some(a), Some(t)) => Some(AdminRotationProposal {
                new_admin: a,
                proposed_at: t,
                execute_after: t + ADMIN_ROTATION_TIME_LOCK,
            }),
            _ => None,
        }
    }

    /// Stores the SHA-256 hash of a recovery secret. The secret itself must
    /// be kept off-chain and used only for emergency rotation.
    pub fn set_recovery_key_hash(
        env: Env,
        caller: Address,
        key_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage()
            .persistent()
            .set(&DataKey::RecoveryKeyHash, &key_hash);
        env.storage()
            .persistent()
            .set(&DataKey::RecoveryKeyUsed, &false);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("rky_set")),
            (caller, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Rotates the admin address immediately, bypassing the time lock.
    /// Requires the pre-registered recovery secret (SHA-256 must match stored hash).
    /// The recovery secret is consumed after one use.
    pub fn emergency_admin_rotation(
        env: Env,
        caller: Address,
        new_admin: Address,
        recovery_key: Bytes,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let stored_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::RecoveryKeyHash)
            .ok_or(ContractError::InvalidRecoveryKey)?;

        let already_used: bool = env
            .storage()
            .persistent()
            .get(&DataKey::RecoveryKeyUsed)
            .unwrap_or(false);
        if already_used {
            return Err(ContractError::RecoveryKeyConsumed);
        }

        let provided_hash: BytesN<32> = env.crypto().sha256(&recovery_key).into();
        if provided_hash != stored_hash {
            return Err(ContractError::InvalidRecoveryKey);
        }

        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if new_admin == old_admin {
            return Err(ContractError::SameAdmin);
        }

        env.storage()
            .persistent()
            .set(&DataKey::RecoveryKeyUsed, &true);
        env.storage()
            .persistent()
            .remove(&DataKey::PendingAdminAddress);
        env.storage()
            .persistent()
            .remove(&DataKey::AdminAddressRotationRequestedAt);

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        let now = env.ledger().timestamp();
        let mut history: Vec<RotationRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::RotationHistory)
            .unwrap_or(Vec::new(&env));
        history.push_back(RotationRecord {
            old_admin: old_admin.clone(),
            new_admin: new_admin.clone(),
            rotated_at: now,
        });
        env.storage()
            .persistent()
            .set(&DataKey::RotationHistory, &history);
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("emg_rot")),
            (old_admin, new_admin, now),
        );
        Ok(())
    }

    // ── Permission delegation (issue #125) ────────────────────────────────

    /// Grants a specific permission to a delegate address.
    /// The admin retains full control; delegations can be revoked at any time.
    pub fn delegate_permission(
        env: Env,
        caller: Address,
        delegate: Address,
        permission: DelegatedPermission,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage()
            .persistent()
            .set(&DataKey::Delegation(delegate.clone(), permission.clone()), &true);
        let now = env.ledger().timestamp();
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("dlg"), symbol_short!("grant")),
            (caller, delegate, now),
        );
        Ok(())
    }

    /// Revokes a previously granted permission from a delegate.
    pub fn revoke_delegation(
        env: Env,
        caller: Address,
        delegate: Address,
        permission: DelegatedPermission,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage()
            .persistent()
            .remove(&DataKey::Delegation(delegate.clone(), permission.clone()));
        let now = env.ledger().timestamp();
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("dlg"), symbol_short!("revoke")),
            (caller, delegate, now),
        );
        Ok(())
    }

    /// Returns `true` if `delegate` currently holds the given `permission`.
    pub fn has_delegation(
        env: Env,
        delegate: Address,
        permission: DelegatedPermission,
    ) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Delegation(delegate, permission))
            .unwrap_or(false)
    }

    // ── Successor delegation & emergency contact (issue #125) ─────────────

    /// Sets an emergency contact address that can be used to propose rotation
    /// if the admin becomes unresponsive.
    pub fn set_emergency_contact(
        env: Env,
        caller: Address,
        contact: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyContact, &contact);
        let now = env.ledger().timestamp();
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("ec_set")),
            (caller, contact, now),
        );
        Ok(())
    }

    /// Returns the current emergency contact, if set.
    pub fn get_emergency_contact(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::EmergencyContact)
    }

    /// Designates a successor who may take over if the admin is inactive for
    /// 365 consecutive days.
    pub fn set_successor(
        env: Env,
        caller: Address,
        successor: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if successor == admin {
            return Err(ContractError::SameAdmin);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Successor, &successor);
        let now = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::SuccessorSetAt, &now);
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("succ_set")),
            (caller, successor, now),
        );
        Ok(())
    }

    /// Returns the designated successor address, if set.
    pub fn get_successor(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Successor)
    }

    /// Revokes the successor designation. Only the current admin can revoke.
    pub fn revoke_successor(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        if !env.storage().persistent().has(&DataKey::Successor) {
            return Err(ContractError::NoSuccessorSet);
        }
        env.storage().persistent().remove(&DataKey::Successor);
        env.storage().persistent().remove(&DataKey::SuccessorSetAt);
        let now = env.ledger().timestamp();
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("succ_rev")),
            (caller, now),
        );
        Ok(())
    }

    /// Called by the designated successor to take over admin control.
    /// Succeeds only if admin has been inactive for at least 365 days.
    pub fn confirm_succession(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();

        let successor: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Successor)
            .ok_or(ContractError::NoSuccessorSet)?;
        if caller != successor {
            return Err(ContractError::NotSuccessor);
        }

        let last_activity: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LastAdminActivity)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        if now.saturating_sub(last_activity) < ADMIN_INACTIVITY_THRESHOLD {
            return Err(ContractError::AdminStillActive);
        }

        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        env.storage().instance().set(&DataKey::Admin, &caller);

        let mut history: Vec<RotationRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::RotationHistory)
            .unwrap_or(Vec::new(&env));
        history.push_back(RotationRecord {
            old_admin: old_admin.clone(),
            new_admin: caller.clone(),
            rotated_at: now,
        });
        env.storage()
            .persistent()
            .set(&DataKey::RotationHistory, &history);
        env.storage().persistent().remove(&DataKey::Successor);
        env.storage().persistent().remove(&DataKey::SuccessorSetAt);
        Self::update_admin_activity(&env, now);
        env.events().publish(
            (symbol_short!("adm"), symbol_short!("succ_ok")),
            (old_admin, caller, now),
        );
        Ok(())
    }

    /// Lets the admin prove they are active, resetting the inactivity clock
    /// used by the successor takeover mechanism.
    pub fn ping_admin(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        Self::update_admin_activity(&env, env.ledger().timestamp());
        Ok(())
    }

    /// Returns the timestamp of the admin's last recorded activity.
    pub fn get_last_admin_activity(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::LastAdminActivity)
            .unwrap_or(0)
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

    // ── Merkle root & result commitment storage ────────────────────────────

    /// Stores the Merkle root of all vote hashes for a ballot on-chain.
    ///
    /// The root is a `BytesN<32>` computed by the backend from the Merkle tree
    /// of all individual vote hashes.  Once set it is immutable for the ballot.
    pub fn set_merkle_root(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        merkle_root: BytesN<32>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }
        Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        let key = DataKey::MerkleRoot(ballot_id_hash.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::MerkleRootAlreadySet);
        }
        env.storage().persistent().set(&key, &merkle_root);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("mkrl_set")),
            (ballot_id_hash, merkle_root, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Returns the stored Merkle root for a ballot, if one has been set.
    pub fn get_merkle_root(env: Env, ballot_id_hash: String) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::MerkleRoot(ballot_id_hash))
    }

    /// Stores a result commitment (SHA-256 of all vote hashes concatenated) on-chain.
    ///
    /// This provides an independent, compact proof that the backend processed a
    /// specific set of votes.  The commitment is a 64-char lowercase hex SHA-256
    /// digest.  Once set it is immutable for the ballot.
    pub fn set_result_commitment(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        commitment: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }
        if !is_valid_sha256_hex(&commitment) {
            return Err(ContractError::InvalidResultCommitment);
        }
        Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        let key = DataKey::ResultCommitment(ballot_id_hash.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::ResultCommitmentAlreadySet);
        }
        env.storage().persistent().set(&key, &commitment);
        env.events().publish(
            (symbol_short!("audit"), symbol_short!("rscmt_set")),
            (ballot_id_hash, commitment, env.ledger().timestamp()),
        );
        Ok(())
    }

    /// Returns the stored result commitment for a ballot, if one has been set.
    pub fn get_result_commitment(env: Env, ballot_id_hash: String) -> Option<String> {
        env.storage()
            .persistent()
            .get(&DataKey::ResultCommitment(ballot_id_hash))
    }

    // ── Batch Merkle proof verification ─────────────────────────────────────

    /// Verifies multiple Merkle proofs against the stored result hash in a
    /// single call, reducing on-chain computation costs.
    ///
    /// Each proof is independently verified.  The returned
    /// `BatchVerificationResult` contains per-proof boolean results so callers
    /// can identify exactly which proofs failed.
    pub fn verify_batch_proofs(
        env: Env,
        ballot_id_hash: String,
        proofs: Vec<MerkleProof>,
    ) -> Result<BatchVerificationResult, ContractError> {
        Self::require_not_paused(&env)?;
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }
        let result_key = DataKey::ResultHash(ballot_id_hash.clone());
        if !env.storage().persistent().has(&result_key) {
            return Err(ContractError::BallotNotFound);
        }
        let stored_result_hash: String = env
            .storage()
            .persistent()
            .get(&result_key)
            .ok_or(ContractError::InternalError)?;

        let total = proofs.len();
        let mut verified: u32 = 0;
        let mut failed: u32 = 0;
        let mut results = Vec::new(&env);

        for i in 0..total {
            let proof = proofs.get(i).unwrap();
            let is_valid = Self::verify_merkle_path(&env, &proof, &stored_result_hash);
            results.push_back(is_valid);
            if is_valid {
                verified += 1;
            } else {
                failed += 1;
            }
        }

        Ok(BatchVerificationResult {
            total_proofs: total,
            verified,
            failed,
            results,
        })
    }

    /// Core Merkle path verification used by both single and batch verification.
    ///
    /// Returns `true` if the proof's vote hash, when walked up the Merkle path,
    /// produces the expected root hex **and** that root hex matches
    /// `expected_root_hex`.
    fn verify_merkle_path(
        env: &Env,
        proof: &MerkleProof,
        expected_root_hex: &String,
    ) -> bool {
        let mut current_hash = proof.vote_hash.clone();
        let mut idx = proof.index;

        for sibling in proof.path.iter() {
            let mut data = Bytes::new(env);
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

        let computed_root_hex = bytes_to_hex(env, &current_hash);
        computed_root_hex == *expected_root_hex
    }

    // ── Cross-contract verification ─────────────────────────────────────────

    /// Calls an external governance-token contract to verify that `voter`
    /// holds the governance token (returns `true` if eligible).
    ///
    /// This is a cross-contract call — the target contract must expose a
    /// `bal_of(address) -> bool` view method.  The result is recorded on
    /// chain for audit purposes.
    pub fn verify_token_holder(
        env: Env,
        caller: Address,
        governance_contract: Address,
        voter: Address,
    ) -> Result<bool, ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::verify_initialized(&env)?;

        // Cross-contract call: invoke bal_of on the governance token contract.
        let args = soroban_sdk::Vec::from_array(&env, [voter.to_val()]);
        let is_eligible: bool = env.invoke_contract(
            &governance_contract,
            &symbol_short!("bal_of"),
            args,
        );

        // Store the verification record for audit trail.
        let record_key = voter.to_string();
        let record = CrossContractCallRecord {
            ballot_id_hash: String::from_str(&env, ""),
            contract_address: governance_contract.to_string(),
            method: String::from_str(&env, "bal_of"),
            result: is_eligible,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::CrossContractRecord(record_key), &record);

        Ok(is_eligible)
    }

    /// Calls an external oracle contract to retrieve the current price for
    /// `asset`.
    ///
    /// The target contract must expose a `g_price(asset) -> i128`
    /// view method that returns the price in the smallest unit (e.g. cents).
    pub fn get_price_from_oracle(
        env: Env,
        caller: Address,
        oracle_contract: Address,
        asset: String,
    ) -> Result<i128, ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::verify_initialized(&env)?;

        let args = soroban_sdk::Vec::from_array(&env, [asset.to_val()]);
        let price: i128 = env.invoke_contract(
            &oracle_contract,
            &symbol_short!("g_price"),
            args,
        );

        Ok(price)
    }

    /// Returns a stored cross-contract verification record, if one exists.
    pub fn get_cross_contract_record(
        env: Env,
        record_key: String,
    ) -> Option<CrossContractCallRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::CrossContractRecord(record_key))
    }

    /// Stores a result commitment and Merkle root atomically, then verifies
    /// a batch of proofs — all in a single transaction.
    ///
    /// This is a convenience wrapper for backends that want to commit the
    /// full verification bundle in one call.
    pub fn commit_and_verify(
        env: Env,
        caller: Address,
        ballot_id_hash: String,
        merkle_root: BytesN<32>,
        result_commitment: String,
        proofs: Vec<MerkleProof>,
    ) -> Result<BatchVerificationResult, ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        if !is_valid_sha256_hex(&ballot_id_hash) {
            return Err(ContractError::InvalidBallotIdHash);
        }
        Self::require_ballot_metadata(&env, &ballot_id_hash)?;

        // Store merkle root (ignore AlreadySet — idempotent commit)
        let root_key = DataKey::MerkleRoot(ballot_id_hash.clone());
        if !env.storage().persistent().has(&root_key) {
            env.storage().persistent().set(&root_key, &merkle_root);
        }

        // Store result commitment (ignore AlreadySet — idempotent commit)
        let commitment_key = DataKey::ResultCommitment(ballot_id_hash.clone());
        if !env.storage().persistent().has(&commitment_key) {
            if !is_valid_sha256_hex(&result_commitment) {
                return Err(ContractError::InvalidResultCommitment);
            }
            env.storage().persistent().set(&commitment_key, &result_commitment);
        }

        // Verify batch
        Self::verify_batch_proofs(env, ballot_id_hash, proofs)
    }

    /// Validates per-ballot limits against the contract-wide caps (issue #105).
    ///
    /// Rejects zero-capacity ballots (the on-chain equivalent of a ballot with
    /// no options) and any limit that exceeds the global maximum, so a ballot
    /// can never grow unbounded.
    fn validate_ballot_limits(limits: &BallotLimits) -> Result<(), ContractError> {
        // A ballot with no token or vote capacity can never be used.
        if limits.max_tokens == 0 || limits.max_votes == 0 {
            return Err(ContractError::EmptyOptions);
        }
        // Bounds token issuance so storage and tally stay bounded.
        if limits.max_tokens > MAX_VOTERS_PER_BALLOT {
            return Err(ContractError::TooManyVoters);
        }
        // Bounds the vote counter; also makes u32 overflow unreachable.
        if limits.max_votes > MAX_VOTES_PER_BALLOT {
            return Err(ContractError::BallotFull);
        }
        Ok(())
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

                // Validate state transition: result can only be published from Closed state
                let metadata_key = DataKey::BallotMetadata(ballot_id_hash.clone());
                let mut metadata = Self::require_ballot_metadata(env, ballot_id_hash)?;

                if metadata.state != BallotState::Closed {
                    return Err(ContractError::BallotNotInClosedState);
                }

                env.storage().persistent().set(&result_key, result_hash);
                metadata.state = BallotState::Tallied;
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

    fn is_zero_key(key: &BytesN<32>) -> bool {
        let arr = key.to_array();
        arr.iter().all(|&b| b == 0)
    }

    fn update_admin_activity(env: &Env, timestamp: u64) {
        env.storage()
            .persistent()
            .set(&DataKey::LastAdminActivity, &timestamp);
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
    use soroban_sdk::testutils::{Address as _, Events, Ledger};
    use soroban_sdk::IntoVal;

    const BALLOT_A: &str = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const BALLOT_B: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const BALLOT_C: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const BALLOT_G: &str = "6666666666666666666666666666666666666666666666666666666666666666";
    const RESULT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const RESULT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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

    /// Drives a ballot through Created -> Voting -> Closed and publishes a
    /// result via the M-of-N path (second approver + emergency execute to skip
    /// the 48h time lock).
    fn publish_result(
        client: &AnonVoteContractClient<'static>,
        admin: &Address,
        approver2: &Address,
        ballot: &String,
        result_hash: &String,
    ) {
        client.start_voting(admin, ballot);
        client.close_voting(admin, ballot);
        let op_id = client.record_result(admin, ballot, result_hash);
        client.approve_operation(&op_id, approver2);
        client.emergency_execute(admin, &op_id);
    }

    /// Pauses the contract via the M-of-N path (second approver + emergency
    /// execute to skip the time lock).
    fn pause_contract_via_multisig(
        client: &AnonVoteContractClient<'static>,
        admin: &Address,
        approver2: &Address,
    ) {
        let op_id = client.pause_contract(admin);
        client.approve_operation(&op_id, approver2);
        client.emergency_execute(admin, &op_id);
    }

    /// Builds a unique 64-char lowercase hex ballot id from `n` (e.g. `0` ->
    /// `"0000...0000"`, `1` -> `"0000...0001"`).
    fn hex_ballot_id(env: &Env, n: u32) -> String {
        let mut buf = [b'0'; 64];
        let hex_chars = b"0123456789abcdef";
        let mut v = n;
        let mut i = 63usize;
        while v > 0 && i > 0 {
            buf[i] = hex_chars[(v & 0xf) as usize];
            v >>= 4;
            i -= 1;
        }
        if v > 0 {
            buf[0] = hex_chars[(v & 0xf) as usize];
        }
        let s = unsafe { core::str::from_utf8_unchecked(&buf) };
        String::from_str(env, s)
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
        client.start_voting(&a1, &ballot);

        client.record_token(&a1, &ballot);
        client.record_vote(&a1, &ballot);

        assert_eq!(client.get_tokens_issued(&ballot), Some(1));
        assert_eq!(client.get_votes_cast(&ballot), Some(1));
        assert!(client.is_consistent(&ballot));

        // Close voting, then publish the result via the M-of-N path.
        client.close_voting(&a1, &ballot);
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
        client.start_voting(&a1, &ballot);
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

    // ── Merkle root storage tests ───────────────────────────────────────

    #[test]
    fn set_and_get_merkle_root() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let root = BytesN::from_array(&env, &[1u8; 32]);
        client.set_merkle_root(&admin, &ballot, &root);

        let stored = client.get_merkle_root(&ballot);
        assert_eq!(stored, Some(root));
    }

    #[test]
    fn get_merkle_root_returns_none_before_set() {
        let (env, client, _admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        assert_eq!(client.get_merkle_root(&ballot), None);
    }

    #[test]
    fn set_merkle_root_rejects_duplicate() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let root = BytesN::from_array(&env, &[1u8; 32]);
        client.set_merkle_root(&admin, &ballot, &root);

        let root2 = BytesN::from_array(&env, &[2u8; 32]);
        assert_eq!(
            client.try_set_merkle_root(&admin, &ballot, &root2),
            Err(Ok(ContractError::MerkleRootAlreadySet))
        );
    }

    #[test]
    fn set_merkle_root_rejects_non_admin() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));
        let outsider = Address::generate(&env);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_set_merkle_root(&outsider, &ballot, &root),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn set_merkle_root_rejects_nonexistent_ballot() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_set_merkle_root(&admin, &ballot, &root),
            Err(Ok(ContractError::BallotNotFound))
        );
    }

    #[test]
    fn set_merkle_root_rejects_invalid_hash() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, "not-a-valid-hex-hash");

        let root = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_set_merkle_root(&admin, &ballot, &root),
            Err(Ok(ContractError::InvalidBallotIdHash))
        );
    }

    #[test]
    fn set_merkle_root_rejects_when_paused() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        pause_contract_via_multisig(&client, &admin, &approver2);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_set_merkle_root(&admin, &ballot, &root),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn set_merkle_root_emits_event() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let root = BytesN::from_array(&env, &[1u8; 32]);
        client.set_merkle_root(&admin, &ballot, &root);

        let events = env.events().all();
        let found = events.iter().any(|(_, topics, _)| {
            topics == (symbol_short!("audit"), symbol_short!("mkrl_set")).into_val(&env)
        });
        assert!(found);
    }

    // ── Result commitment storage tests ──────────────────────────────────

    #[test]
    fn set_and_get_result_commitment() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let commitment = String::from_str(&env, RESULT_A);
        client.set_result_commitment(&admin, &ballot, &commitment);

        let stored = client.get_result_commitment(&ballot);
        assert_eq!(stored, Some(commitment));
    }

    #[test]
    fn get_result_commitment_returns_none_before_set() {
        let (env, client, _admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        assert_eq!(client.get_result_commitment(&ballot), None);
    }

    #[test]
    fn set_result_commitment_rejects_duplicate() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let commitment = String::from_str(&env, RESULT_A);
        client.set_result_commitment(&admin, &ballot, &commitment);

        let commitment2 = String::from_str(&env, RESULT_B);
        assert_eq!(
            client.try_set_result_commitment(&admin, &ballot, &commitment2),
            Err(Ok(ContractError::ResultCommitmentAlreadySet))
        );
    }

    #[test]
    fn set_result_commitment_rejects_invalid_hex() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let bad = String::from_str(&env, "not-valid-hex");
        assert_eq!(
            client.try_set_result_commitment(&admin, &ballot, &bad),
            Err(Ok(ContractError::InvalidResultCommitment))
        );
    }

    #[test]
    fn set_result_commitment_rejects_non_admin() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));
        let outsider = Address::generate(&env);

        let commitment = String::from_str(&env, RESULT_A);
        assert_eq!(
            client.try_set_result_commitment(&outsider, &ballot, &commitment),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn set_result_commitment_rejects_nonexistent_ballot() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);

        let commitment = String::from_str(&env, RESULT_A);
        assert_eq!(
            client.try_set_result_commitment(&admin, &ballot, &commitment),
            Err(Ok(ContractError::BallotNotFound))
        );
    }

    #[test]
    fn set_result_commitment_rejects_when_paused() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        pause_contract_via_multisig(&client, &admin, &approver2);

        let commitment = String::from_str(&env, RESULT_A);
        assert_eq!(
            client.try_set_result_commitment(&admin, &ballot, &commitment),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn set_result_commitment_emits_event() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let commitment = String::from_str(&env, RESULT_A);
        client.set_result_commitment(&admin, &ballot, &commitment);

        let events = env.events().all();
        let found = events.iter().any(|(_, topics, _)| {
            topics == (symbol_short!("audit"), symbol_short!("rscmt_set")).into_val(&env)
        });
        assert!(found);
    }

    // ── Batch verification tests ─────────────────────────────────────────

    #[test]
    fn verify_batch_proofs_valid_proofs() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let leaf1 = BytesN::from_array(&env, &[2u8; 32]);

        let mut data = Bytes::new(&env);
        data.extend_from_array(&leaf0.to_array());
        data.extend_from_array(&leaf1.to_array());
        let root: BytesN<32> = env.crypto().sha256(&data).into();
        let root_hex = bytes_to_hex(&env, &root);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let proof0 = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };
        let proof1 = MerkleProof {
            vote_hash: leaf1.clone(),
            path: Vec::from_array(&env, [leaf0.clone()]),
            index: 1,
        };

        let proofs = Vec::from_array(&env, [proof0, proof1]);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 2);
        assert_eq!(result.verified, 2);
        assert_eq!(result.failed, 0);
    }

    #[test]
    fn verify_batch_proofs_rejects_invalid_proofs() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let leaf1 = BytesN::from_array(&env, &[2u8; 32]);

        let mut data = Bytes::new(&env);
        data.extend_from_array(&leaf0.to_array());
        data.extend_from_array(&leaf1.to_array());
        let root: BytesN<32> = env.crypto().sha256(&data).into();
        let root_hex = bytes_to_hex(&env, &root);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        // Valid proof for leaf0
        let proof0 = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };
        // Invalid proof: wrong vote hash
        let bad_proof = MerkleProof {
            vote_hash: BytesN::from_array(&env, &[0u8; 32]),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };

        let proofs = Vec::from_array(&env, [proof0, bad_proof]);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 2);
        assert_eq!(result.verified, 1);
        assert_eq!(result.failed, 1);
    }

    #[test]
    fn verify_batch_proofs_empty_batch() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let root_hex = bytes_to_hex(&env, &leaf0);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let proofs = Vec::new(&env);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 0);
        assert_eq!(result.verified, 0);
        assert_eq!(result.failed, 0);
    }

    #[test]
    fn verify_batch_proofs_rejects_no_result_published() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let proof = MerkleProof {
            vote_hash: BytesN::from_array(&env, &[1u8; 32]),
            path: Vec::new(&env),
            index: 0,
        };
        let proofs = Vec::from_array(&env, [proof]);

        assert_eq!(
            client.try_verify_batch_proofs(&ballot, &proofs),
            Err(Ok(ContractError::BallotNotFound))
        );
    }

    #[test]
    fn verify_batch_proofs_rejects_invalid_ballot_hash() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let proof = MerkleProof {
            vote_hash: BytesN::from_array(&env, &[1u8; 32]),
            path: Vec::new(&env),
            index: 0,
        };
        let proofs = Vec::from_array(&env, [proof]);
        let bad_ballot = String::from_str(&env, "invalid");

        assert_eq!(
            client.try_verify_batch_proofs(&bad_ballot, &proofs),
            Err(Ok(ContractError::InvalidBallotIdHash))
        );
    }

    #[test]
    fn verify_batch_proofs_all_invalid() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let root_hex = bytes_to_hex(&env, &leaf0);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let bad_proof = MerkleProof {
            vote_hash: BytesN::from_array(&env, &[0u8; 32]),
            path: Vec::new(&env),
            index: 0,
        };
        let proofs = Vec::from_array(&env, [bad_proof]);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 1);
        assert_eq!(result.verified, 0);
        assert_eq!(result.failed, 1);
    }

    #[test]
    fn verify_batch_proofs_single_node_tree() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let root_hex = bytes_to_hex(&env, &leaf0);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let proof = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::new(&env),
            index: 0,
        };
        let proofs = Vec::from_array(&env, [proof]);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 1);
        assert_eq!(result.verified, 1);
    }

    #[test]
    fn verify_batch_proofs_rejects_when_paused() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        pause_contract_via_multisig(&client, &admin, &approver2);

        let proofs = Vec::new(&env);
        assert_eq!(
            client.try_verify_batch_proofs(&ballot, &proofs),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn verify_batch_proofs_wrong_index() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let leaf1 = BytesN::from_array(&env, &[2u8; 32]);

        let mut data = Bytes::new(&env);
        data.extend_from_array(&leaf0.to_array());
        data.extend_from_array(&leaf1.to_array());
        let root: BytesN<32> = env.crypto().sha256(&data).into();
        let root_hex = bytes_to_hex(&env, &root);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        // Proof with correct hash but wrong index
        let proof = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 1, // Should be 0
        };
        let proofs = Vec::from_array(&env, [proof]);
        let result = client.verify_batch_proofs(&ballot, &proofs);

        assert_eq!(result.total_proofs, 1);
        assert_eq!(result.failed, 1);
    }

    // ── Commit and verify tests ──────────────────────────────────────────

    #[test]
    fn commit_and_verify_stores_root_and_commitment_and_verifies() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let leaf1 = BytesN::from_array(&env, &[2u8; 32]);

        let mut data = Bytes::new(&env);
        data.extend_from_array(&leaf0.to_array());
        data.extend_from_array(&leaf1.to_array());
        let root: BytesN<32> = env.crypto().sha256(&data).into();
        let root_hex = bytes_to_hex(&env, &root);

        // Publish result first (required by batch verify)
        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let commitment = String::from_str(&env, RESULT_A);
        let proof0 = MerkleProof {
            vote_hash: leaf0.clone(),
            path: Vec::from_array(&env, [leaf1.clone()]),
            index: 0,
        };
        let proof1 = MerkleProof {
            vote_hash: leaf1.clone(),
            path: Vec::from_array(&env, [leaf0.clone()]),
            index: 1,
        };
        let proofs = Vec::from_array(&env, [proof0, proof1]);

        let result = client.commit_and_verify(&admin, &ballot, &root, &commitment, &proofs);

        assert_eq!(result.total_proofs, 2);
        assert_eq!(result.verified, 2);
        assert_eq!(client.get_merkle_root(&ballot), Some(root));
        assert_eq!(client.get_result_commitment(&ballot), Some(commitment));
    }

    #[test]
    fn commit_and_verify_rejects_non_admin() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));
        let outsider = Address::generate(&env);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        let commitment = String::from_str(&env, RESULT_A);
        let proofs = Vec::new(&env);

        assert_eq!(
            client.try_commit_and_verify(&outsider, &ballot, &root, &commitment, &proofs),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn commit_and_verify_rejects_invalid_commitment_hex() {
        let (env, client, admin, _, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let root = BytesN::from_array(&env, &[1u8; 32]);
        let bad_commitment = String::from_str(&env, "not-hex");
        let proofs = Vec::new(&env);

        assert_eq!(
            client.try_commit_and_verify(&admin, &ballot, &root, &bad_commitment, &proofs),
            Err(Ok(ContractError::InvalidResultCommitment))
        );
    }

    #[test]
    fn commit_and_verify_rejects_when_paused() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        pause_contract_via_multisig(&client, &admin, &approver2);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        let commitment = String::from_str(&env, RESULT_A);
        let proofs = Vec::new(&env);

        assert_eq!(
            client.try_commit_and_verify(&admin, &ballot, &root, &commitment, &proofs),
            Err(Ok(ContractError::ContractPaused))
        );
    }

    #[test]
    fn commit_and_verify_idempotent_root_setting() {
        let (env, client, admin, approver2, _) = setup();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&admin, &ballot, &limits(10, 10));

        let leaf0 = BytesN::from_array(&env, &[1u8; 32]);
        let root_hex = bytes_to_hex(&env, &leaf0);

        publish_result(&client, &admin, &approver2, &ballot, &root_hex);

        let root = BytesN::from_array(&env, &[1u8; 32]);
        let commitment = String::from_str(&env, RESULT_A);
        let proofs = Vec::new(&env);

        // First call stores everything
        let _ = client.commit_and_verify(&admin, &ballot, &root, &commitment, &proofs);
        // Second call should not error (idempotent)
        let _ = client.commit_and_verify(&admin, &ballot, &root, &commitment, &proofs);

        assert_eq!(client.get_merkle_root(&ballot), Some(root));
        assert_eq!(client.get_result_commitment(&ballot), Some(commitment));
    }

    // ── Cross-contract record tests ──────────────────────────────────────

    #[test]
    fn get_cross_contract_record_returns_none_for_unknown_key() {
        let (env, client, _admin, _, _) = setup();
        let key = String::from_str(&env, "unknown");
        assert_eq!(client.get_cross_contract_record(&key), None);
    }

    // ── Issue #125: Admin address rotation with time-lock ─────────────────

    fn setup_rotation() -> (Env, AnonVoteContractClient<'static>, Address, Address, Address) {
        setup()
    }

    #[test]
    fn test_admin_propose_rotation_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        let proposal = client.get_pending_admin_rotation().unwrap();
        assert_eq!(proposal.new_admin, new_admin);
        assert!(proposal.execute_after > proposal.proposed_at);
    }

    #[test]
    fn test_admin_propose_rotation_same_admin_rejected() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        assert_eq!(
            client.try_admin_propose_rotation(&a1, &a1),
            Err(Ok(ContractError::SameAdmin))
        );
    }

    #[test]
    fn test_admin_propose_rotation_duplicate_rejected() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        let another = Address::generate(&env);
        assert_eq!(
            client.try_admin_propose_rotation(&a1, &another),
            Err(Ok(ContractError::RotationAlreadyPending))
        );
    }

    #[test]
    fn test_admin_propose_rotation_unauthorized_rejected() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let outsider = Address::generate(&env);
        let new_admin = Address::generate(&env);
        assert_eq!(
            client.try_admin_propose_rotation(&outsider, &new_admin),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn test_execute_admin_rotation_before_timelock_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        assert_eq!(
            client.try_execute_admin_rotation(),
            Err(Ok(ContractError::AddressRotationTooSoon))
        );
    }

    #[test]
    fn test_execute_admin_rotation_after_timelock_succeeds() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        env.ledger().with_mut(|l| {
            l.timestamp += ADMIN_ROTATION_TIME_LOCK + 1;
        });
        client.execute_admin_rotation();
        assert_eq!(client.get_admin().unwrap(), new_admin);
        assert!(client.get_pending_admin_rotation().is_none());
    }

    #[test]
    fn test_execute_admin_rotation_appends_history() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        env.ledger().with_mut(|l| {
            l.timestamp += ADMIN_ROTATION_TIME_LOCK + 1;
        });
        client.execute_admin_rotation();
        let history = client.get_rotation_history();
        assert_eq!(history.len(), 1);
        let record = history.get(0).unwrap();
        assert_eq!(record.old_admin, a1);
        assert_eq!(record.new_admin, new_admin);
    }

    #[test]
    fn test_execute_admin_rotation_no_pending_fails() {
        let (_env, client, _a1, _a2, _a3) = setup_rotation();
        assert_eq!(
            client.try_execute_admin_rotation(),
            Err(Ok(ContractError::NoRotationPending))
        );
    }

    #[test]
    fn test_cancel_admin_rotation_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        client.cancel_admin_rotation(&a1);
        assert!(client.get_pending_admin_rotation().is_none());
        assert_eq!(client.get_admin().unwrap(), a1);
    }

    #[test]
    fn test_cancel_admin_rotation_no_pending_fails() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        assert_eq!(
            client.try_cancel_admin_rotation(&a1),
            Err(Ok(ContractError::NoRotationPending))
        );
    }

    #[test]
    fn test_cancel_admin_rotation_unauthorized_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_cancel_admin_rotation(&outsider),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn test_set_recovery_key_hash_success() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        let key_hash = BytesN::from_array(&_env, &[0xABu8; 32]);
        client.set_recovery_key_hash(&a1, &key_hash);
    }

    #[test]
    fn test_emergency_rotation_with_valid_key_succeeds() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let secret = Bytes::from_array(&env, &[0x42u8; 32]);
        let key_hash: BytesN<32> = env.crypto().sha256(&secret).into();
        client.set_recovery_key_hash(&a1, &key_hash);
        let new_admin = Address::generate(&env);
        client.emergency_admin_rotation(&a1, &new_admin, &secret);
        assert_eq!(client.get_admin().unwrap(), new_admin);
    }

    #[test]
    fn test_emergency_rotation_wrong_key_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let secret = Bytes::from_array(&env, &[0x42u8; 32]);
        let key_hash: BytesN<32> = env.crypto().sha256(&secret).into();
        client.set_recovery_key_hash(&a1, &key_hash);
        let wrong = Bytes::from_array(&env, &[0xFFu8; 32]);
        let new_admin = Address::generate(&env);
        assert_eq!(
            client.try_emergency_admin_rotation(&a1, &new_admin, &wrong),
            Err(Ok(ContractError::InvalidRecoveryKey))
        );
    }

    #[test]
    fn test_emergency_rotation_consumed_key_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let secret = Bytes::from_array(&env, &[0x42u8; 32]);
        let key_hash: BytesN<32> = env.crypto().sha256(&secret).into();
        client.set_recovery_key_hash(&a1, &key_hash);
        let new_admin = Address::generate(&env);
        client.emergency_admin_rotation(&a1, &new_admin, &secret);
        let another = Address::generate(&env);
        assert_eq!(
            client.try_emergency_admin_rotation(&new_admin, &another, &secret),
            Err(Ok(ContractError::RecoveryKeyConsumed))
        );
    }

    #[test]
    fn test_emergency_rotation_cancels_pending_rotation() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let pending = Address::generate(&env);
        client.admin_propose_rotation(&a1, &pending);
        let secret = Bytes::from_array(&env, &[0x99u8; 32]);
        let key_hash: BytesN<32> = env.crypto().sha256(&secret).into();
        client.set_recovery_key_hash(&a1, &key_hash);
        let emergency_admin = Address::generate(&env);
        client.emergency_admin_rotation(&a1, &emergency_admin, &secret);
        assert!(client.get_pending_admin_rotation().is_none());
        assert_eq!(client.get_admin().unwrap(), emergency_admin);
    }

    // ── Issue #125: Permission delegation ─────────────────────────────────

    #[test]
    fn test_delegate_permission_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let delegate = Address::generate(&env);
        client.delegate_permission(&a1, &delegate, &DelegatedPermission::PauseContract);
        assert!(client.has_delegation(&delegate, &DelegatedPermission::PauseContract));
    }

    #[test]
    fn test_delegate_permission_unauthorized_fails() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let outsider = Address::generate(&env);
        let delegate = Address::generate(&env);
        assert_eq!(
            client.try_delegate_permission(&outsider, &delegate, &DelegatedPermission::PauseContract),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn test_revoke_delegation_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let delegate = Address::generate(&env);
        client.delegate_permission(&a1, &delegate, &DelegatedPermission::RotateKey);
        assert!(client.has_delegation(&delegate, &DelegatedPermission::RotateKey));
        client.revoke_delegation(&a1, &delegate, &DelegatedPermission::RotateKey);
        assert!(!client.has_delegation(&delegate, &DelegatedPermission::RotateKey));
    }

    #[test]
    fn test_has_delegation_returns_false_without_grant() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let stranger = Address::generate(&env);
        assert!(!client.has_delegation(&stranger, &DelegatedPermission::ChangeThreshold));
    }

    #[test]
    fn test_multiple_permissions_independent() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let delegate = Address::generate(&env);
        client.delegate_permission(&a1, &delegate, &DelegatedPermission::PauseContract);
        assert!(client.has_delegation(&delegate, &DelegatedPermission::PauseContract));
        assert!(!client.has_delegation(&delegate, &DelegatedPermission::ChangeThreshold));
        assert!(!client.has_delegation(&delegate, &DelegatedPermission::RotateKey));
    }

    // ── Issue #125: Successor delegation ──────────────────────────────────

    #[test]
    fn test_set_successor_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        assert_eq!(client.get_successor().unwrap(), successor);
    }

    #[test]
    fn test_set_successor_same_as_admin_fails() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        assert_eq!(
            client.try_set_successor(&a1, &a1),
            Err(Ok(ContractError::SameAdmin))
        );
    }

    #[test]
    fn test_revoke_successor_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        client.revoke_successor(&a1);
        assert!(client.get_successor().is_none());
    }

    #[test]
    fn test_revoke_successor_no_successor_fails() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        assert_eq!(
            client.try_revoke_successor(&a1),
            Err(Ok(ContractError::NoSuccessorSet))
        );
    }

    #[test]
    fn test_confirm_succession_admin_still_active_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        assert_eq!(
            client.try_confirm_succession(&successor),
            Err(Ok(ContractError::AdminStillActive))
        );
    }

    #[test]
    fn test_confirm_succession_after_inactivity_succeeds() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        env.ledger().with_mut(|l| {
            l.timestamp += ADMIN_INACTIVITY_THRESHOLD + 1;
        });
        client.confirm_succession(&successor);
        assert_eq!(client.get_admin().unwrap(), successor);
        assert!(client.get_successor().is_none());
    }

    #[test]
    fn test_confirm_succession_appends_history() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        env.ledger().with_mut(|l| {
            l.timestamp += ADMIN_INACTIVITY_THRESHOLD + 1;
        });
        client.confirm_succession(&successor);
        let history = client.get_rotation_history();
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().old_admin, a1);
        assert_eq!(history.get(0).unwrap().new_admin, successor);
    }

    #[test]
    fn test_confirm_succession_wrong_caller_fails() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let successor = Address::generate(&env);
        client.set_successor(&a1, &successor);
        env.ledger().with_mut(|l| {
            l.timestamp += ADMIN_INACTIVITY_THRESHOLD + 1;
        });
        let impostor = Address::generate(&env);
        assert_eq!(
            client.try_confirm_succession(&impostor),
            Err(Ok(ContractError::NotSuccessor))
        );
    }

    #[test]
    fn test_confirm_succession_no_successor_fails() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_confirm_succession(&stranger),
            Err(Ok(ContractError::NoSuccessorSet))
        );
    }

    // ── Issue #125: Emergency contact ─────────────────────────────────────

    #[test]
    fn test_set_emergency_contact_success() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let contact = Address::generate(&env);
        client.set_emergency_contact(&a1, &contact);
        assert_eq!(client.get_emergency_contact().unwrap(), contact);
    }

    #[test]
    fn test_get_emergency_contact_none_by_default() {
        let (_env, client, _a1, _a2, _a3) = setup_rotation();
        assert!(client.get_emergency_contact().is_none());
    }

    #[test]
    fn test_set_emergency_contact_unauthorized_fails() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let outsider = Address::generate(&env);
        let contact = Address::generate(&env);
        assert_eq!(
            client.try_set_emergency_contact(&outsider, &contact),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    // ── Issue #125: Activity tracking ─────────────────────────────────────

    #[test]
    fn test_ping_admin_updates_activity() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        env.ledger().with_mut(|l| { l.timestamp = 1_000_000; });
        client.ping_admin(&a1);
        assert_eq!(client.get_last_admin_activity(), 1_000_000);
    }

    #[test]
    fn test_ping_admin_unauthorized_fails() {
        let (env, client, _a1, _a2, _a3) = setup_rotation();
        let outsider = Address::generate(&env);
        assert_eq!(
            client.try_ping_admin(&outsider),
            Err(Ok(ContractError::AdminUnauthorized))
        );
    }

    #[test]
    fn test_initialize_seeds_admin_activity() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_000_000;
        });
        let contract_id = env.register_contract(None, AnonVoteContract);
        let client = AnonVoteContractClient::new(&env, &contract_id);
        let a1 = Address::generate(&env);
        let a2 = Address::generate(&env);
        let a3 = Address::generate(&env);
        let approvers = Vec::from_array(&env, [a1, a2, a3]);
        client.initialize(&approvers, &2);
        assert!(client.get_last_admin_activity() > 0);
    }

    #[test]
    fn test_propose_rotation_updates_activity() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let before = client.get_last_admin_activity();
        env.ledger().with_mut(|l| { l.timestamp = before + 500; });
        let new_admin = Address::generate(&env);
        client.admin_propose_rotation(&a1, &new_admin);
        assert_eq!(client.get_last_admin_activity(), before + 500);
    }

    // ── Issue #105: Contract limits & counter overflow ────────────────────

    #[test]
    fn test_get_contract_limits_exposes_caps() {
        let (_env, client, _a1, _a2, _a3) = setup_rotation();
        let limits = client.get_contract_limits();
        assert_eq!(limits.max_options_per_ballot, MAX_OPTIONS_PER_BALLOT);
        assert_eq!(limits.max_voters_per_ballot, MAX_VOTERS_PER_BALLOT);
        assert_eq!(limits.max_votes_per_ballot, MAX_VOTES_PER_BALLOT);
        assert_eq!(limits.max_ballots, MAX_BALLOTS);
    }

    #[test]
    fn test_record_ballot_rejects_zero_token_capacity() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&_env, BALLOT_A);
        assert_eq!(
            client.try_record_ballot(&a1, &ballot, &limits(0, 10)),
            Err(Ok(ContractError::EmptyOptions))
        );
    }

    #[test]
    fn test_record_ballot_rejects_zero_vote_capacity() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&_env, BALLOT_B);
        assert_eq!(
            client.try_record_ballot(&a1, &ballot, &limits(10, 0)),
            Err(Ok(ContractError::EmptyOptions))
        );
    }

    #[test]
    fn test_record_ballot_rejects_too_many_voters() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&_env, BALLOT_A);
        assert_eq!(
            client.try_record_ballot(&a1, &ballot, &limits(MAX_VOTERS_PER_BALLOT + 1, 10)),
            Err(Ok(ContractError::TooManyVoters))
        );
    }

    #[test]
    fn test_record_ballot_rejects_too_many_votes() {
        let (_env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&_env, BALLOT_A);
        assert_eq!(
            client.try_record_ballot(&a1, &ballot, &limits(10, MAX_VOTES_PER_BALLOT + 1)),
            Err(Ok(ContractError::BallotFull))
        );
    }

    #[test]
    fn test_record_ballot_accepts_exactly_max_limits() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(
            &a1,
            &ballot,
            &limits(MAX_VOTERS_PER_BALLOT, MAX_VOTES_PER_BALLOT),
        );
        assert!(client.ballot_exists(&ballot));
        assert_eq!(client.get_tokens_issued(&ballot), Some(0));
        assert_eq!(client.get_votes_cast(&ballot), Some(0));
    }

    #[test]
    fn test_record_ballots_batch_rejects_invalid_limits_atomically() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let id_good = String::from_str(&env, BALLOT_A);
        let id_bad = String::from_str(&env, BALLOT_B);
        let ballots = Vec::from_array(
            &env,
            [
                (id_good.clone(), limits(10, 10)),
                (id_bad.clone(), limits(10, MAX_VOTES_PER_BALLOT + 1)),
            ],
        );

        assert_eq!(
            client.try_record_ballots_batch(&a1, &ballots),
            Err(Ok(ContractError::BallotFull))
        );
        // All-or-nothing: neither ballot was recorded.
        assert!(!client.ballot_exists(&id_good));
        assert!(!client.ballot_exists(&id_bad));
    }

    #[test]
    fn test_record_ballots_batch_rejects_too_many_ballots() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let mut ballots = Vec::new(&env);
        // Build a batch of MAX_BALLOTS + 1 unique ballot ids. The test-env
        // budget is reset periodically while building the arg vector itself.
        for i in 0..(MAX_BALLOTS + 1) {
            if i % 100 == 0 {
                env.budget().reset_default();
            }
            let id = hex_ballot_id(&env, i);
            ballots.push_back((id, limits(10, 10)));
        }
        assert_eq!(
            client.try_record_ballots_batch(&a1, &ballots),
            Err(Ok(ContractError::LimitExceeded))
        );
    }

    #[test]
    fn test_record_token_rejects_when_voter_cap_reached() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&a1, &ballot, &limits(3, 10));
        client.start_voting(&a1, &ballot);

        client.record_token(&a1, &ballot);
        client.record_token(&a1, &ballot);
        client.record_token(&a1, &ballot);
        assert_eq!(client.get_tokens_issued(&ballot), Some(3));

        assert_eq!(
            client.try_record_token(&a1, &ballot),
            Err(Ok(ContractError::TooManyVoters))
        );
    }

    #[test]
    fn test_record_vote_rejects_when_ballot_full() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(&a1, &ballot, &limits(10, 3));
        client.start_voting(&a1, &ballot);

        client.record_vote(&a1, &ballot);
        client.record_vote(&a1, &ballot);
        client.record_vote(&a1, &ballot);
        assert_eq!(client.get_votes_cast(&ballot), Some(3));

        // The counter reached the cap without panicking or wrapping.
        assert_eq!(
            client.try_record_vote(&a1, &ballot),
            Err(Ok(ContractError::BallotFull))
        );
        assert_eq!(client.get_votes_cast(&ballot), Some(3));
    }

    /// Fills the contract to its 10,000-ballot cap and verifies further
    /// registrations are rejected. Needs 10,000 separate invocations, so it
    /// only runs with `--ignored` to keep the default suite fast.
    #[test]
    #[ignore]
    fn test_ballot_total_cap_enforced_across_batches() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        for i in 0..MAX_BALLOTS {
            if i % 100 == 0 {
                env.budget().reset_default();
            }
            let id = hex_ballot_id(&env, i);
            client.record_ballot(&a1, &id, &limits(10, 10));
        }

        // Any further ballot, single or batched, is rejected.
        let extra = String::from_str(&env, BALLOT_G);
        assert_eq!(
            client.try_record_ballot(&a1, &extra, &limits(10, 10)),
            Err(Ok(ContractError::LimitExceeded))
        );
        assert_eq!(
            client.try_record_ballots_batch(
                &a1,
                &Vec::from_array(&env, [(extra.clone(), limits(10, 10))])
            ),
            Err(Ok(ContractError::LimitExceeded))
        );
    }

    /// Full-scale stress run: fills a ballot configured at the contract-wide
    /// caps to its 100,000-voter / 1,000,000-vote maximum. This needs ~1.1M
    /// contract invocations, so it only runs with `--ignored` (e.g.
    /// `cargo test --release -- --ignored stress`). The test host retains
    /// every emitted event and charges ~10-20ms per invocation, so the default
    /// suite runs the smaller `stress_test_counter_never_overflows_at_cap`
    /// instead; both assert the same overflow-safety invariants.
    #[test]
    #[ignore]
    fn stress_test_full_scale_ballot_no_overflow() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&env, BALLOT_A);
        client.record_ballot(
            &a1,
            &ballot,
            &limits(MAX_VOTERS_PER_BALLOT, MAX_VOTES_PER_BALLOT),
        );
        client.start_voting(&a1, &ballot);

        for i in 0..MAX_VOTERS_PER_BALLOT {
            if i % 10 == 0 {
                env.budget().reset_default();
            }
            client.record_token(&a1, &ballot);
        }
        for i in 0..MAX_VOTES_PER_BALLOT {
            if i % 10 == 0 {
                env.budget().reset_default();
            }
            client.record_vote(&a1, &ballot);
        }

        assert_eq!(
            client.get_tokens_issued(&ballot),
            Some(MAX_VOTERS_PER_BALLOT)
        );
        assert_eq!(client.get_votes_cast(&ballot), Some(MAX_VOTES_PER_BALLOT));

        assert_eq!(
            client.try_record_vote(&a1, &ballot),
            Err(Ok(ContractError::BallotFull))
        );
        assert_eq!(
            client.try_record_token(&a1, &ballot),
            Err(Ok(ContractError::TooManyVoters))
        );
    }

    #[test]
    fn stress_test_counter_never_overflows_at_cap() {
        let (env, client, a1, _a2, _a3) = setup_rotation();
        let ballot = String::from_str(&env, BALLOT_B);
        // A ballot filled exactly to its cap proves the increment path uses
        // checked arithmetic and rejects instead of wrapping or panicking.
        client.record_ballot(&a1, &ballot, &limits(500, 500));
        client.start_voting(&a1, &ballot);

        for i in 0..500u32 {
            if i % 10 == 0 {
                env.budget().reset_default();
            }
            client.record_token(&a1, &ballot);
            client.record_vote(&a1, &ballot);
        }

        assert_eq!(client.get_tokens_issued(&ballot), Some(500));
        assert_eq!(client.get_votes_cast(&ballot), Some(500));
        assert!(client.is_consistent(&ballot));

        // The cap is enforced — one more would-be increment is rejected, so
        // the u32 counter can never reach its overflow boundary.
        assert_eq!(
            client.try_record_vote(&a1, &ballot),
            Err(Ok(ContractError::BallotFull))
        );
        assert_eq!(
            client.try_record_token(&a1, &ballot),
            Err(Ok(ContractError::TooManyVoters))
        );
    }
}
