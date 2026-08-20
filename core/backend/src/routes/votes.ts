import express from 'express';
import privacyEngine, { DuplicateTokenError, ValidationError } from '../services/privacyEngine';

export function createVotesRouter(deps: { db: any }) {
  const router = express.Router();

  // POST /submit - submit a vote
  router.post('/submit', async (req, res) => {
    const { token, ballotIdHash, optionId, encryptedVote } = req.body ?? {};

    if (!token || !ballotIdHash || !optionId || !encryptedVote) {
      return res.status(400).json({ ok: false, error: 'missing_parameters' });
    }

    try {
      const created = await privacyEngine.submitVoteAtomic(deps.db, {
        token,
        ballotIdHash,
        optionId,
        encryptedVote,
      });

      return res.status(201).json({ ok: true, vote: created });
    } catch (err: any) {
      if (err instanceof DuplicateTokenError) {
        return res.status(409).json({ ok: false, error: 'token_already_used' });
      }

      if (err instanceof ValidationError) {
        return res.status(400).json({ ok: false, error: 'invalid_vote', message: err.message });
      }

      // Unexpected / transient error - suggest retry if safe
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  return router;
}

export default createVotesRouter;
