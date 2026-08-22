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
    InvalidAdminKey = 26,
    KeyRotationAlreadyPending = 27,
    NoKeyRotationPending = 28,
    RotationTooSoon = 29,
    KeyRotationUnauthorized = 30,
    AdminKeyNotInitialized = 31,
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
    ApproverActivity(Address),
    RejectionCooldown(OperationType),
}

#[contract]
pub struct AnonVoteContract;

#[contractimpl]
impl AnonVoteContract {
    pub fn get_version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

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

    pub fn propose_operation(
        env: Env,
        caller: Address,
        op_type: OperationType,
    ) -> Result<u64, ContractError> {
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

        let cooldown_key = DataKey::RejectionCooldown(op_type.clone());
        if let Some(rejected_at) = env.storage().persistent().get::<_, u64>(&cooldown_key) {
            let now = env.ledger().timestamp();
            if now.saturating_sub(rejected_at) < REJECTION_COOLDOWN_SECONDS {
                return Err(ContractError::CooldownActive);
            }
        }

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

    pub fn approve_operation(
        env: Env,
        operation_id: u64,
        approver_address: Address,
    ) -> Result<bool, ContractError> {
        approver_address.require_auth();
        Self::require_not_paused(&env)?;
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
        pending.approval_count = pending.approvals.len() as u32;
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

    pub fn execute_operation(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
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

        let now = env.ledger().timestamp();
        if now > pending.expires_at {
            pending.status = OperationStatus::Expired;
            env.storage().persistent().set(&key, &pending);
            return Err(ContractError::OperationExpired);
        }

        if pending.approval_count < pending.threshold {
            return Err(ContractError::ThresholdNotMet);
        }

        if now < pending.time_lock_until {
            return Err(ContractError::TimeLockNotExpired);
        }

        Self::execute_operation_internal(&env, &mut pending)?;
        env.storage().persistent().set(&key, &pending);
        Ok(())
    }

    pub fn emergency_execute(
        env: Env,
        caller: Address,
        operation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
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

        let now = env.ledger().timestamp();
        if now > pending.expires_at {
            pending.status = OperationStatus::Expired;
            env.storage().persistent().set(&key, &pending);
            return Err(ContractError::OperationExpired);
        }

        if pending.approval_count < pending.threshold {
            return Err(ContractError::ThresholdNotMet);
        }

        Self::execute_operation_internal(&env, &mut pending)?;
        env.storage().persistent().set(&key, &pending);
        Ok(())
    }

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

    pub fn get_approver_activity(env: Env, approver: Address) -> Option<ApproverActivity> {
        env.storage()
            .persistent()
            .get(&DataKey::ApproverActivity(approver))
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

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
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

    fn execute_operation_internal(env: &Env, pending: &mut PendingOperation) -> Result<(), ContractError> {
        match &pending.operation {
            OperationType::PauseContract => {
                env.storage().instance().set(&DataKey::IsPaused, &true);
            }
            OperationType::UnpauseContract => {
                env.storage().instance().set(&DataKey::IsPaused, &false);
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
            }
            OperationType::UpgradeContract(_) | OperationType::ResultPublication(_, _) | OperationType::AdminRotation(_) => {}
        }
        pending.status = OperationStatus::Executed;
        Ok(())
    }

    fn verify_initialized(env: &Env) -> Result<(), ContractError> {
        if env.storage().instance().get::<DataKey, Address>(&DataKey::Admin).is_none() {
            return Err(ContractError::NotInitialized);
        }
        Ok(())
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
}
