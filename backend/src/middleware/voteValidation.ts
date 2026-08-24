/**
 * Request validation middleware for vote submissions.
 * 
 * Validates vote payloads early to reject malformed requests before
 * they reach the database or rate limiting layer, reducing load and
 * preventing potential DoS through malformed payloads.
 */

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";

// Configuration constants
const MAX_ENCRYPTED_VOTE_LENGTH = parseInt(
  process.env.MAX_ENCRYPTED_VOTE_LENGTH || "4096",
  10
);
const MIN_ENCRYPTED_VOTE_LENGTH = 32; // Minimum reasonable encrypted payload size

// Token format: base64url-encoded, 32-43 characters (depends on encoding)
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,43}$/;

// UUID v4 format for ballot and option IDs
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates vote submission payload structure and constraints.
 * Rejects requests that are clearly malformed or malicious.
 */
export function validateVotePayload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const {
      ballot_id,
      ballotId,
      token,
      voterToken,
      option_id,
      optionId,
      weight,
      rank,
      encrypted_option,
      encryptedOption,
    } = req.body;

    const errors: string[] = [];

    // ── Ballot ID validation ──────────────────────────────────────────────
    const finalBallotId = ballot_id || ballotId;
    if (!finalBallotId) {
      errors.push("ballot_id is required");
    } else if (typeof finalBallotId !== "string") {
      errors.push("ballot_id must be a string");
    } else if (!finalBallotId.trim()) {
      errors.push("ballot_id cannot be empty");
    } else if (!UUID_PATTERN.test(finalBallotId)) {
      errors.push("ballot_id must be a valid UUID");
    }

    // ── Token validation ──────────────────────────────────────────────────
    const finalToken = token || voterToken;
    if (!finalToken) {
      errors.push("token is required");
    } else if (typeof finalToken !== "string") {
      errors.push("token must be a string");
    } else if (!finalToken.trim()) {
      errors.push("token cannot be empty");
    } else if (!TOKEN_PATTERN.test(finalToken.trim())) {
      errors.push("token has invalid format");
    }

    // ── Option ID validation ──────────────────────────────────────────────
    const finalOptionId = option_id || optionId;
    if (!finalOptionId) {
      errors.push("option_id is required");
    } else if (typeof finalOptionId !== "string") {
      errors.push("option_id must be a string");
    } else if (!finalOptionId.trim()) {
      errors.push("option_id cannot be empty");
    } else if (!UUID_PATTERN.test(finalOptionId)) {
      errors.push("option_id must be a valid UUID");
    }

    // ── Encrypted option validation ───────────────────────────────────────
    const finalEncryptedOption = encrypted_option || encryptedOption;
    if (finalEncryptedOption !== undefined) {
      if (typeof finalEncryptedOption !== "string") {
        errors.push("encrypted_option must be a string");
      } else if (
        finalEncryptedOption.length < MIN_ENCRYPTED_VOTE_LENGTH ||
        finalEncryptedOption.length > MAX_ENCRYPTED_VOTE_LENGTH
      ) {
        errors.push(
          `encrypted_option length must be between ${MIN_ENCRYPTED_VOTE_LENGTH} and ${MAX_ENCRYPTED_VOTE_LENGTH} characters`
        );
      }
    }

    // ── Weight validation (optional, for weighted voting) ────────────────
    if (weight !== undefined && weight !== null) {
      const numWeight = Number(weight);
      if (isNaN(numWeight)) {
        errors.push("weight must be a valid number");
      } else if (numWeight < 0) {
        errors.push("weight cannot be negative");
      } else if (numWeight > 1000000) {
        errors.push("weight exceeds maximum allowed value");
      } else if (!Number.isInteger(numWeight) && numWeight !== Math.floor(numWeight * 100) / 100) {
        errors.push("weight must have at most 2 decimal places");
      }
    }

    // ── Rank validation (optional, for ranked-choice voting) ─────────────
    if (rank !== undefined && rank !== null) {
      const numRank = Number(rank);
      if (isNaN(numRank)) {
        errors.push("rank must be a valid number");
      } else if (!Number.isInteger(numRank)) {
        errors.push("rank must be an integer");
      } else if (numRank < 1) {
        errors.push("rank must be at least 1");
      } else if (numRank > 100) {
        errors.push("rank exceeds maximum allowed value (100)");
      }
    }

    // ── Reject if any validation errors ───────────────────────────────────
    if (errors.length > 0) {
      throw new AppError(
        `Validation failed: ${errors.join("; ")}`,
        400,
        "VALIDATION_ERROR"
      );
    }

    // Validation passed - proceed to next middleware
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Validates payload size to prevent large request DoS attacks.
 */
export function validatePayloadSize(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const maxSize = parseInt(process.env.MAX_VOTE_PAYLOAD_SIZE || "10240", 10); // 10KB default
  
  const contentLength = req.headers["content-length"];
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    return next(
      new AppError(
        `Request payload too large. Maximum size: ${maxSize} bytes`,
        413,
        "PAYLOAD_TOO_LARGE"
      )
    );
  }

  next();
}

/**
 * Validates Content-Type header to ensure JSON requests.
 */
export function validateContentType(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers["content-type"];
  
  if (!contentType || !contentType.includes("application/json")) {
    return next(
      new AppError(
        "Content-Type must be application/json",
        415,
        "UNSUPPORTED_MEDIA_TYPE"
      )
    );
  }

  next();
}

/**
 * Combined validation middleware that applies all vote validations.
 * Use this as a single middleware on the vote route.
 */
export function validateVoteRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  validateContentType(req, res, (err1) => {
    if (err1) return next(err1);
    
    validatePayloadSize(req, res, (err2) => {
      if (err2) return next(err2);
      
      validateVotePayload(req, res, next);
    });
  });
}
