// Shared types for AnonVote

export type BallotStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "FINALISED";
export type AnchorStatus = "PENDING" | "ANCHORED" | "FAILED";

export type AuditEventType =
  | "TOKEN_ISSUED"
  | "VOTE_CAST"
  | "RESULT_PUBLISHED"
  | "DUPLICATE_TOKEN_ATTEMPT"
  | "DUPLICATE_VOTE_ATTEMPT";

export interface Organization {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Option {
  id: string;
  ballotId: string;
  text: string;
}

export interface Ballot {
  id: string;
  organizationId: string;
  topic: string;
  status: BallotStatus;
  deadline: string;
  eligibilityListId: string;
  allowWeightedVoting: boolean;
  allowRankedChoice: boolean;
  maxRankings?: number;
  createdAt: string;
  options: Option[];
  votesCast?: number;
  tokensIssued?: number;
  stellarTxId?: string;
  anchorStatus?: AnchorStatus;
  eligibleVoters?: number;
  result?: Result;
  /** E2E-encrypted description envelope, "v1:ephPub:iv:ct". Null = none. */
  descriptionCiphertext?: string | null;
  descriptionKeyVersion?: number | null;
  commitmentHash?: string | null;
  commitmentTxId?: string | null;
  commitmentAnchoredAt?: string | null;
}

export type CommitmentStatus = "verified" | "mismatch" | "unanchored";

export interface BallotCommitment {
  ballotId: string;
  commitmentHash: string;
  onChain: string | null;
  status: CommitmentStatus;
  source: "chain" | "database" | "none";
}

export interface OrgPublicKey {
  organizationId: string;
  /** null until the organization has enrolled a key. */
  publicKey: string | null;
  keyDerivationSalt: string;
  keyVersion: number;
  algorithm: "X25519";
}

export interface AdminBallotSummary {
  id: string;
  topic: string;
  status: BallotStatus;
  deadline: string;
  voterCount: number;
  tokensIssued: number;
  votesReceived: number;
  tallyStatus: "PENDING" | "READY" | "FINALISED";
}

export interface EligibilityList {
  id: string;
  createdAt: string;
}

export interface VoterToken {
  id: string;
  tokenHash: string;
  ballotId: string;
  used: boolean;
  issuedAt: string;
  usedAt?: string;
  delegatedFrom?: string;
  delegatedTo?: string;
}

export interface Vote {
  id: string;
  ballotId: string;
  optionId: string;
  encryptedPayload: string;
  weight: number;
  rank?: number;
  stellarTxId?: string;
  submittedAt: string;
}

export interface Result {
  id: string;
  ballotId: string;
  tallyJson: string;
  totalVotes: number;
  isConsistent: boolean;
  stellarTxId?: string;
  stellarLedgerAt?: string;
  sorobanTxId?: string;
  finalised: boolean;
  finalisedAt?: string;
  publishedAt: string;
  // Enriched fields returned by GET /api/results/:ballotId
  options?: TallyEntry[];
  participationRate?: number;
  tokensIssued?: number;
  explorerUrl?: string;
  sorobanExplorerUrl?: string;
}

export interface AuditEvent {
  id: string;
  ballotId: string;
  eventType: AuditEventType;
  stellarTxId?: string;
  stellarLedgerAt?: string; // Stellar network consensus timestamp
  createdAt: string;
}

export interface AuditCounts {
  tokensIssued: number;
  votesCast: number;
  events: AuditEvent[];
}

// Returned by GET /api/ballots/:id/summary — aggregates ballot + options +
// eligibility/vote/token stats in a single call.
export interface BallotSummary {
  id: string;
  topic: string;
  status: BallotStatus;
  deadline: string;
  startTime?: string | null;
  createdAt: string;
  options: Option[];
  optionCount: number;
  allowWeightedVoting: boolean;
  allowRankedChoice: boolean;
  maxRankings?: number | null;
  eligibleVoters: number;
  tokensIssued: number;
  votesCast: number;
  anchorStatus: AnchorStatus;
  stellarTxId?: string;
}

// Returned by GET /api/ballots/:id/results-summary — aggregates ballot +
// tally + participation + on-chain verification in a single call.
export interface ResultsSummary {
  ballot: {
    id: string;
    topic: string;
    status: BallotStatus;
    deadline: string;
  };
  result: Result | null;
}

// Returned by GET /api/ballots/:id/audit-trail — aggregates ballot info +
// token/vote counts + full event log in a single call.
export interface AuditTrail {
  ballotId: string;
  topic: string;
  status: BallotStatus;
  tokensIssued: number;
  votesCast: number;
  events: AuditEvent[];
}

export interface ApiResponse<T> {
  data: T;
}

export interface TokenResponse {
  token: string;
  weight: number;
}

export interface LoginResponse {
  organizationId: string;
  name: string;
}

export interface TallyEntry {
  optionId: string;
  optionText: string;
  count: number;
  percentage: number;
}

export interface ApiError {
  error: string;
  message: string;
}
