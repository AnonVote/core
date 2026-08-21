/**
 * Lightweight privacy engine helper that validates a ballot and atomically
 * marks a voter token as used while inserting a vote row.
 *
 * This module intentionally keeps no assumptions about the database client
 * beyond: a `transaction()` method returning a transaction object compatible
 * with Knex-style query builder (supports `.forUpdate()` and `.returning()`).
 */

export class DuplicateTokenError extends Error {}
export class ValidationError extends Error {}

export type SubmitVoteInput = {
  token: string;
  ballotIdHash: string;
  optionId: string | number;
  encryptedVote: string;
  now?: number;
};

export async function submitVoteAtomic(db: any, input: SubmitVoteInput) {
  const now = input.now ?? Date.now();

  // Start a transaction; the caller supplies a DB client with transaction()
  const trx = await db.transaction();

  try {
    // 1) Validate ballot existence/state/deadline. Do NOT touch tokens yet.
    const ballot = await trx('ballots')
      .where({ ballot_id_hash: input.ballotIdHash })
      .first();

    if (!ballot) {
      throw new ValidationError('Invalid ballot');
    }

    if (ballot.state !== 'ACTIVE') {
      throw new ValidationError('Ballot is not active');
    }

    if (ballot.deadline && now > Number(ballot.deadline)) {
      throw new ValidationError('Ballot deadline has passed');
    }

    // 2) Validate option exists for the ballot
    const option = await trx('ballot_options')
      .where({ ballot_id_hash: input.ballotIdHash, id: input.optionId })
      .first();

    if (!option) {
      throw new ValidationError('Selected option is not valid for this ballot');
    }

    // 3) Lock the token row with a FOR UPDATE to serialize concurrent requests
    // This ensures two concurrent requests cannot both observe `used = false`.
    const tokenRow = await trx('voter_tokens')
      .where({ token: input.token, ballot_id_hash: input.ballotIdHash })
      .forUpdate()
      .first();

    if (!tokenRow) {
      throw new ValidationError('Token not found');
    }

    if (tokenRow.used) {
      throw new DuplicateTokenError('Token already used');
    }

    // 4) Atomically mark token used and insert vote row in the same transaction
    await trx('voter_tokens')
      .where({ id: tokenRow.id })
      .update({ used: true, used_at: now });

    const [created] = await trx('votes')
      .insert({
        token_id: tokenRow.id,
        ballot_id_hash: input.ballotIdHash,
        option_id: input.optionId,
        encrypted_vote: input.encryptedVote,
        created_at: now,
      })
      .returning('*');

    await trx.commit();

    return created;
  } catch (err) {
    // Rollback on any error so token is never partially committed.
    try {
      await trx.rollback();
    } catch (_) {
      // ignore rollback errors
    }

    throw err;
  }
}

export default {
  submitVoteAtomic,
  DuplicateTokenError,
  ValidationError,
};
