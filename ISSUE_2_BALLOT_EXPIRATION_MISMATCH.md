---
name: "Smart Contract Ballot Expiration State Mismatch with Backend"
about: "Contract and backend disagree on ballot expiration status"
title: "[CONTRACTS] Smart Contract Ballot Expiration State Mismatch with Backend"
labels: ["bug", "critical", "contracts", "blockchain"]
assignees: []
---

## Description

The Soroban smart contract has an `expire_ballot()` function that sets a separate `BallotExpired` flag, but `record_vote()` and `record_token()` functions only check if the ballot is `ACTIVE`, not if it's expired. The backend vote submission logic checks database status but doesn't read the contract's expiration flag. If a ballot is manually expired on-chain, the backend continues accepting votes.

This causes critical inconsistency: contract and backend disagree on whether a ballot is open, leading to audit failures and potential double-voting.

## Expected Behaviour

- When ballot expires, it should reject ALL vote submissions
- Backend database status and contract state should stay synchronized
- Ballot expired on-chain should immediately reject backend votes
- Expiration should be a single authoritative state transition

## Actual Behaviour

- Ballot can be expired on-chain but backend accepts votes
- `record_vote()` doesn't check `BallotExpired` flag
- Backend only checks database, not contract state
- Two expiration mechanisms can diverge
- Audit shows votes after marked expired

## Affected Component

- [x] `contracts/` - Soroban Smart Contract
- [x] `contracts/service/` - Soroban TypeScript Service
- [x] `core/backend/` - Backend Server

## Scope of Work

### Files to Create/Modify

- `contracts/contracts/anonvote/src/lib.rs`
- `contracts/contracts/anonvote/src/validation.rs`
- `contracts/service/sorobanService.ts`
- `core/backend/src/services/ballotEngine.ts`

### Implementation Steps

1. Add `Expired` variant to `BallotState` enum
2. Replace `BallotExpired` flag with state transition: `Active → Expired`
3. Add expiration check to vote recording
4. Update `record_vote()` to check expiration
5. Update `record_token()` to check expiration
6. Synchronize backend with contract state

## Out of Scope

- Do not change deadline-based expiration logic
- Do not modify vote validation beyond expiration check
- Frontend UI changes are separate

## Security & Privacy Considerations

✅ Ballot state MUST be single source of truth  
✅ Expiration transitions MUST be atomic  
✅ Admin expiration MUST emit audit event  
✅ No votes accepted after expiration

## Acceptance Criteria

- [ ] `BallotState` enum includes `Expired` variant
- [ ] `record_vote()` rejects with error if expired
- [ ] `record_token()` rejects with error if expired
- [ ] State transition to `Expired` is atomic
- [ ] Backend verifies contract state before votes
- [ ] Backend and contract synchronized in tests
- [ ] Error code is stable and documented
- [ ] Unit test for active → expired
- [ ] Integration test for vote rejection

## Testing Strategy

### Test Cases

- ✅ Active ballot - vote accepted
- ✅ Expired ballot - vote rejected
- ✅ Admin expires ballot - state changes
- ✅ Audit event emitted
- ✅ Backend and contract agree
- ✅ Expired ballot cannot be re-activated

## Priority & Effort

- **Priority:** Critical
- **Estimated Effort:** 2-4h
- **Type:** Bug

---

## Note for Contributors

**Non-negotiable rules:**

- ✅ Expiration state MUST be atomic
- ✅ Check MUST happen in `record_vote()` before state change
- ✅ Backend MUST verify contract state
- ✅ Error code must be stable
- ✅ Audit events MUST be emitted
- ✅ Do NOT split expiration logic

## Implementation Checklist

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] No security vulnerabilities
- [ ] No PII in logs
- [ ] Documentation updated
- [ ] Commits atomic
- [ ] No breaking changes
- [ ] All criteria met
- [ ] Ready for review
