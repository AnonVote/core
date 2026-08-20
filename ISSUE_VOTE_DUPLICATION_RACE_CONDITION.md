---
name: "Vote Duplication Race Condition in Token Usage Check"
about: "Critical bug allowing concurrent duplicate votes to bypass validation"
title: "[CONTRACTS] Vote Duplication Race Condition in Token Usage Check"
labels: ["bug", "critical", "contracts"]
assignees: []
---

## Description

The `submitVote` function in the privacy engine marks a voter token as "used" BEFORE validating the ballot state and deadline. If two concurrent requests with the same token arrive while the first is still processing, both can bypass the duplicate check. Additionally, if ballot validation fails after the token is marked as used, the token remains permanently stuck in "used" state, preventing legitimate retries.

This is a critical election integrity bug that directly violates the single-vote guarantee.

## Expected Behaviour

- Only ONE vote per token should ever be accepted
- If ballot validation fails, the token should NOT be marked as used
- Concurrent requests with the same token should be serialized (first wins, second gets duplicate error)
- Retries should be possible if validation fails before token is committed

## Actual Behaviour

- Two identical vote submissions can both pass the token check if they arrive simultaneously
- Tokens can become stuck in "used" state even if the ballot is closed, inactive, or invalid
- Voters cannot retry if the first attempt fails due to a backend error

## Affected Component

- [x] `contracts/service/` - Soroban TypeScript Service
- [x] `core/backend/` - Backend Server (privacy engine, vote routes)

## Scope of Work

### Files to Create/Modify

- `core/backend/src/services/privacyEngine.ts`
- `core/backend/src/routes/votes.ts`

### Implementation Steps

1. Refactor transaction order — validate ALL ballot state BEFORE token update
2. Use database transactions correctly with pessimistic locking
3. Check: ballot is ACTIVE, deadline not passed, option exists, rate limits not exceeded
4. ONLY THEN update token to used=true atomically
5. Add retry logic and clear error messages

## Out of Scope

- Do not change Stellar ledger interaction
- Do not modify database schema
- Do not implement queuing/backoff

## Security & Privacy Considerations

✅ Vote uniqueness MUST be guaranteed atomically  
✅ Token state must never be partially committed  
✅ Race condition window must be zero

## Acceptance Criteria

- [ ] Token is checked as unused AND marked as used in same atomic transaction
- [ ] All ballot validation occurs BEFORE token is marked used
- [ ] Concurrent duplicate votes fail with clear error message
- [ ] Retries work if validation fails before token commit
- [ ] Unit test covers concurrent submission scenario
- [ ] Integration test verifies race condition is fixed
- [ ] No performance regression
- [ ] Transaction rollback works correctly

## Testing Strategy

### Test Cases

- ✅ Valid vote with unique token (happy path)
- ✅ Duplicate token submission - second request gets conflict
- ✅ Concurrent identical submissions - only one succeeds
- ✅ Ballot closed - vote rejected, token NOT marked used
- ✅ Deadline passed - vote rejected, token NOT marked used

## Priority & Effort

- **Priority:** Critical
- **Estimated Effort:** 1-2h
- **Type:** Bug

---

## Note for Contributors

**Non-negotiable rules:**

- ✅ MUST use database transactions
- ✅ ALL ballot validation MUST occur BEFORE token is marked as used
- ✅ Race condition window must be zero
- ✅ Test MUST include concurrent submission simulation

## Implementation Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] No new security vulnerabilities
- [ ] No PII in logs
- [ ] Documentation updated
- [ ] Commits are atomic
- [ ] All acceptance criteria met
- [ ] Ready for code review
