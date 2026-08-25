Closes #121

## What changed

Implemented an enforceable ballot lifecycle with deadline handling,
write-once result publication, and audited emergency recovery.

- Added the `Created -> Active -> Expired -> ResultPublished` state machine.
- Added deadline-aware ballot creation and explicit activation.
- Rejects votes and token writes at or after the ledger deadline, including
  the exact boundary timestamp.
- Requires ballots to be expired before results can be proposed and prevents
  all result overwrites after publication.
- Added backwards-only recovery through the existing critical-operation
  approval workflow, with a minimum 3-of-5 governance configuration.
- Enforced a 30-day recovery window and ten-recoveries-per-month rate limit.
- Added a separate recovery audit trail, recovery-frequency getter, and
  recovery event for monitoring/indexing.
- Documented the state and recovery guarantees in `STABILITY.md`.

## Why

Previously, ballot expiry was manual, result publication could bypass the
expired state, and there was no controlled way to repair an incorrect or
corrupt ballot state. These gaps allowed late writes and made state transitions
dependent on transaction ordering.

## Implementation notes

Critical result and recovery operations are validated both when proposed and
when the final approval executes. This closes approval-window races where the
ballot state, age, or rate-limit count changes while signatures are pending.
Recovering a published result removes the old result hash so a corrected tally
can be published only after the ballot returns through the required states.

## Testing

The Rust suite now contains 49 tests covering existing governance behavior and
the new state machine, including activation, invalid transitions, exact expiry
boundaries, finalization, 3-of-5 recovery approval, backwards-only recovery,
the 30-day cutoff, audit history, and recovery-frequency tracking.

Run with:

```sh
cd contracts/anonvote
cargo test
```
