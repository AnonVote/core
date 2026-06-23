// Shared types for AnonVote

export type BallotStatus = "DRAFT" | "OPEN" | "CLOSED";
export type AnchorStatus = "PENDING" | "SUCCESS" | "FAILED";

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
