# Stability Guarantees

## ContractError Discriminant Values

The `ContractError` enum in `contracts/anonvote/src/errors.rs` defines error codes
returned by the AnonVote Soroban contract. Each variant has a fixed `#[repr(u32)]`
discriminant.

**These discriminant values must never change after the contract is deployed.**
Consumers that parse error codes from Stellar transaction results depend on the
numeric value, not the variant name. Changing a value is a breaking change.

| Variant                | Value | Description                              |
|------------------------|-------|------------------------------------------|
| AlreadyInitialized     | 1     | initialize called after admin is set     |
| Unauthorized           | 2     | caller is not the admin                  |
| BallotAlreadyExists    | 3     | record_ballot called with existing hash  |
| BallotNotFound         | 4     | write op with unregistered ballot        |
| BallotAlreadyFinalised | 5     | record_result after result is set        |
| InvalidBallotIdHash    | 6     | ballot_id_hash not valid 64-char hex     |
| InvalidResultHash      | 7     | result_hash not valid 64-char hex        |
| InvalidAdminAddress    | 8     | new admin address is zero or same        |
| CounterOverflow        | 9     | token/vote counter exceeds u32::MAX      |
| BallotExpired          | 10    | operation after ballot ledger expiry     |

## Storage Key Stability

Storage keys used for instance and persistent storage are derived from the
`DataKey` enum variants. Variant names must not be changed or reordered after
deployment.

## Event Topics

Events published by the contract use fixed topic symbols. Changing topic
symbols is a breaking change for off-chain event indexers.

## Ballot State Machine

Deadline-aware ballots follow this forward-only lifecycle during normal
operation:

`Created -> Active -> Expired -> ResultPublished`

- `record_ballot_with_deadline` creates a ballot in `Created`; the deadline is
  immutable and must be in the future.
- `activate_ballot` is the only normal transition to `Active`.
- Votes and token records require `Active`, and the ledger timestamp must be
  strictly less than the deadline. At the exact deadline they are rejected.
- `expire_ballot` transitions `Active` to `Expired` only once the deadline has
  been reached.
- Result publication requires `Expired`; the stored result is write-once.

The legacy `record_ballot` and batch entry points remain immediately active
with no automatic deadline (`expiration_time == 0`) for API compatibility, but
still require explicit expiry before result publication.

Recovery is the sole exception to forward-only transitions. It is proposed as
a governance operation, requires a configured threshold of at least 3-of-5,
may only move backwards, is unavailable once a ballot is 30 days old, and is
limited to ten executed recoveries per 30-day bucket. Each recovery is stored
in the separate recovery history and emits the `(audit, recovery)` event.
