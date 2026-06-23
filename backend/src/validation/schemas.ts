/**
 * Validation schemas for all election and voting endpoints.
 *
 * Keep schemas here — separate from business logic — so they can be
 * updated, tested, and reused without touching route handlers.
 */
import { ValidationSchema } from "../middleware/validate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null; // type check already handles this
  if (!ISO_DATE_RE.test(value) || isNaN(Date.parse(value))) {
    return "deadline must be a valid ISO 8601 date string";
  }
  const d = new Date(value);
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  if (d < oneHourFromNow) {
    return "deadline must be at least 1 hour in the future";
  }
  return null;
}

function isStringArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null; // array type check handles this
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return "options must be an array of non-empty strings";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Organization schemas
// ---------------------------------------------------------------------------

export const createOrganizationSchema: ValidationSchema = {
  name: {
    required: true,
    type: "string",
    min: 1,
    max: 100,
    label: "name",
  },
  email: {
    required: true,
    type: "string",
    pattern: EMAIL_RE,
    label: "email",
  },
  password: {
    required: true,
    type: "string",
    min: 8,
    max: 128,
    label: "password",
  },
};

export const loginOrganizationSchema: ValidationSchema = {
  name: {
    required: true,
    type: "string",
    min: 1,
    label: "name",
  },
  password: {
    required: true,
    type: "string",
    min: 1,
    label: "password",
  },
};

export const updateOrganizationSchema: ValidationSchema = {
  name: {
    type: "string",
    min: 1,
    max: 100,
    label: "name",
  },
  email: {
    type: "string",
    pattern: EMAIL_RE,
    label: "email",
  },
};

export const changePasswordSchema: ValidationSchema = {
  currentPassword: {
    required: true,
    type: "string",
    min: 1,
    label: "currentPassword",
  },
  newPassword: {
    required: true,
    type: "string",
    min: 8,
    max: 128,
    label: "newPassword",
  },
};

// ---------------------------------------------------------------------------
// Ballot (election) schemas
// ---------------------------------------------------------------------------

export const createBallotSchema: ValidationSchema = {
  topic: {
    required: true,
    type: "string",
    min: 1,
    max: 500,
    label: "topic",
  },
  options: {
    required: true,
    type: "array",
    min: 2,
    max: 10,
    label: "options",
    custom: isStringArray,
  },
  eligibilityListId: {
    required: true,
    type: "string",
    min: 1,
    label: "eligibilityListId",
  },
  deadline: {
    required: true,
    type: "string",
    label: "deadline",
    custom: isIsoDate,
  },
  allowWeightedVoting: {
    type: "boolean",
    label: "allowWeightedVoting",
  },
  allowRankedChoice: {
    type: "boolean",
    label: "allowRankedChoice",
  },
  maxRankings: {
    type: "number",
    min: 1,
    max: 100,
    label: "maxRankings",
  },
};

export const updateBallotSchema: ValidationSchema = {
  topic: {
    type: "string",
    min: 1,
    max: 500,
    label: "topic",
  },
  deadline: {
    type: "string",
    label: "deadline",
    custom: (v) => (v !== undefined ? isIsoDate(v) : null),
  },
  eligibilityListId: {
    type: "string",
    min: 1,
    label: "eligibilityListId",
  },
  options: {
    type: "array",
    min: 2,
    max: 100,
    label: "options",
    custom: (v) => (v !== undefined ? isStringArray(v) : null),
  },
};

// ---------------------------------------------------------------------------
// Vote schemas
// ---------------------------------------------------------------------------

export const submitVoteSchema: ValidationSchema = {
  ballotId: {
    required: true,
    type: "string",
    min: 1,
    label: "ballotId",
  },
  voterToken: {
    required: true,
    type: "string",
    min: 1,
    max: 512,
    label: "voterToken",
  },
  optionId: {
    required: true,
    type: "string",
    min: 1,
    label: "optionId",
  },
  weight: {
    type: "number",
    min: 0.01,
    max: 1000,
    label: "weight",
  },
  rank: {
    type: "number",
    min: 1,
    max: 100,
    label: "rank",
  },
};

// ---------------------------------------------------------------------------
// Token schemas
// ---------------------------------------------------------------------------

export const issueTokenSchema: ValidationSchema = {
  ballotId: {
    required: true,
    type: "string",
    min: 1,
    label: "ballotId",
  },
  voterIdentifier: {
    required: true,
    type: "string",
    min: 1,
    max: 256,
    label: "voterIdentifier",
  },
};

// reissue uses the same fields
export const reissueTokenSchema: ValidationSchema = issueTokenSchema;

// ---------------------------------------------------------------------------
// Delegation schemas
// ---------------------------------------------------------------------------

export const delegateVoteSchema: ValidationSchema = {
  ballotId: {
    required: true,
    type: "string",
    min: 1,
    label: "ballotId",
  },
  delegatorTokenHash: {
    required: true,
    type: "string",
    min: 1,
    label: "delegatorTokenHash",
  },
  delegateTokenHash: {
    required: true,
    type: "string",
    min: 1,
    label: "delegateTokenHash",
  },
};
