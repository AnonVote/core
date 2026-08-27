# Ballot metadata encryption and commitments

Reference for Issue #86.

## Threat model — read this first

**Protects against:** a passive operator reading ballot descriptions, and anyone
who obtains a copy of the database. Descriptions are stored only as ciphertext,
and the decryption key is derived in the browser from the admin's password.

**Does NOT protect against an actively malicious server.** Password verification
uses bcrypt server-side, so the server *sees the plaintext password at login* and
could derive the organization's private key at that moment. This is E2EE against
a passive operator and against database compromise — not against a server that is
actively attacking its own users. Closing that gap needs an augmented PAKE (e.g.
OPAQUE), which is out of scope here.

The commitment is what protects voters: it lets anyone detect a ballot altered
after voters were invited, including alteration by the operator.

### Two corrections to the issue as written

- **There was no `title`/`description` column.** `Ballot` had only `topic`;
  `description` is *created* by this work, so there is no pre-existing plaintext
  description to migrate.
- **`topic` could not be encrypted.** `GET /api/ballots/:id` is public and
  anonymous voters must read the topic to vote, the results page is public by
  design, and `emailService` puts the topic in email subject lines. Encrypting it
  would make ballots unreadable to the people voting on them. `topic` therefore
  stays plaintext.

## Two independent things

1. **Encrypted descriptions** — an admin-only `Ballot.description`, encrypted in
   the browser to the organization's X25519 public key. The server stores only
   ciphertext.
2. **Ballot commitments** — a SHA-256 commitment over a ballot's user-visible
   content, anchored on-chain when voting opens, so a voter can detect a ballot
   altered after they were invited.

They are related only in that the commitment covers the description *ciphertext*,
which is what lets a voter verify a ballot without being able to read it.

## Key derivation

```
salt        = Organization.keyDerivationSalt      (16 random bytes, server-generated, public)
seed        = PBKDF2-HMAC-SHA256(password, salt, 210_000, 32)
privKey     = HKDF-SHA256(seed, salt, "anonvote-org-x25519-v1", 32)
pubKey      = x25519.getPublicKey(privKey)
```

The private key never leaves the browser. It is cached in `sessionStorage` under
`anonvote-org-sk` (mirroring `storage-crypto.ts`'s `anonvote-sk`), so it survives
a reload in the same tab and is cleared on logout.

## Envelope

```
ephPriv, ephPub = fresh random x25519 keypair, one per ballot
shared     = x25519.getSharedSecret(ephPriv, orgPubKey)
contentKey = HKDF-SHA256(shared, "", "anonvote-ballot-desc-v1" || ephPub || orgPubKey, 32)
iv         = 12 random bytes
ct         = AES-256-GCM(contentKey, iv, plaintext)

envelope   = "v1:" + b64(ephPub) + ":" + b64(iv) + ":" + b64(ct)
```

Binding `ephPub || orgPubKey` into the HKDF `info` prevents unknown-key-share and
key-reuse attacks. The `v1:` prefix makes the envelope self-describing for future
rotation. The colon-separated shape follows the repo's existing convention in
`utils/crypto.ts` and `storage-crypto.ts`.

> This format is **not** interchangeable with the org-key layer in
> `docs/TENANT_ISOLATION.md`, which uses hex `salt:iv:authTag:ciphertext`. The
> two key hierarchies are unrelated.

The backend never decrypts a description. It only shape-checks the envelope
(`assertDescriptionEnvelope` in `ballotEngine.ts`) so an unreadable blob cannot be
stored and silently break the commitment.

## Commitment

`backend/src/utils/commitment.ts` and `frontend/src/utils/commitment.ts` MUST
produce byte-identical output. Both test suites pin the same fixture hash
(`5821ef72…`); if they ever diverge, verification silently breaks for every
ballot.

```
JSON.stringify({
  topic: topic.trim(),
  descriptionCiphertext: descriptionCiphertext ?? "",
  options: options.map(o => o.text.trim()).sort(),
  deadline: deadline.toISOString(),
})
```

Options are sorted because `Option` has no ordering column. A null ciphertext
canonicalizes to `""`, so legacy ballots remain hashable.

### Lifecycle

| Point | What happens |
| --- | --- |
| Ballot created | Commitment computed and persisted |
| DRAFT edit | Commitment recomputed from the written row |
| DRAFT → ACTIVE | Commitment persisted, then anchored on-chain fire-and-forget |
| Anchor fails | Ballot stays valid; verification reports the DB copy or `unanchored` |

`activateBallot()` in `ballotEngine.ts` owns the transition; `utils/scheduler.ts`
calls it instead of updating status inline.

## Verification

`verifyBallotCommitment(ballotId, opts?)` resolves in this order:

1. **chain** — `get_ballot_commitment` on the Soroban contract
2. **database** — `Ballot.commitmentHash`
3. **none** — reports `unanchored`

It returns `{ status, expected, onChain, source }`. `source` matters: a match
against the database copy is **not** the same assurance as a match against the
ledger, and `CommitmentBadge` says so in the UI rather than overclaiming.

`opts.fetchCommitment` is the test injection seam, mirroring
`verifyBallotConsistency`'s `opts.fetchAuditCounts`, so tests need no deployed
contract.

## Contract

```rust
DataKey::BallotCommitment(String)

record_ballot_commitment(env, ballot_id_hash, commitment) -> Result<(), Error>
get_ballot_commitment(env, ballot_id_hash) -> Result<String, Error>
```

Unlike `record_result`, which overwrites unconditionally, this **rejects a second
write** with `Error::CommitmentExists = 5`. Keys are `hashIdentifier(ballotId)`,
never the raw ballot id.

A contract redeploy is required before on-chain verification is live.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/organizations/:id/public-key` | none | Salt + public key (public material only) |
| `POST` | `/api/organizations/me/public-key` | session | Enroll or rotate |
| `GET` | `/api/ballots/:id/commitment` | none | Verify content against the anchor |

### Password change — the sharp edge

Changing the password changes the derived keypair, so every existing description
would become permanently unreadable.

`PATCH /api/organizations/password` additionally accepts `publicKey`,
`reencrypted[]`, and `discardEncryptedDescriptions`. It **refuses** a change that
does not re-encrypt every ballot holding a description, unless
`discardEncryptedDescriptions: true` is passed. Password hash, public key, and
all ciphertexts commit in a single transaction, and the completeness check is
re-run *inside* that transaction so a ballot gaining a description mid-flight
cannot slip past. Ballot ids are filtered on `organizationId`, so a forged id
cannot reach another tenant's row.

There is no password-reset flow in this codebase, so no second path can silently
orphan keys.

## Backfill

```bash
cd backend
npm run backfill:commitments              # compute + persist
npm run backfill:commitments -- --anchor  # also anchor ACTIVE ballots
npm run backfill:commitments -- --dry-run
```

Idempotent; logs a summary. Legacy organizations enroll a public key
automatically at their next login — there is no separate key backfill.

## Known limitations

- A contract redeploy is required before on-chain verification is live. Until
  then the database fallback keeps development and CI working, and the badge
  reports `source: "database"`.
- `NotificationContext` persists ballot topics to `localStorage` in plaintext.
  Harmless now that `topic` is deliberately public, but noted so it is not
  mistaken for a leak introduced by this change.
- Max description length is 5000 characters (~6.7KB base64). PBKDF2 runs at
  210,000 iterations (OWASP guidance for HMAC-SHA256).
