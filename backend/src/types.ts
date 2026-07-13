// Shared types for AnonVote

export type BallotStatus = "OPEN" | "CLOSED";

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
  eligibleVoters?: number;
}

export interface EligibilityList {
  id: string;
  createdAt: string;
}

export interface EligibilityEntry {
  id: string;
  eligibilityListId: string;
  identifierHash: string;
  weight: number;
  tokenIssued: boolean;
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
  publishedAt: string;
}

export interface AuditEvent {
  id: string;
  ballotId: string;
  eventType: AuditEventType;
  stellarTxId?: string;
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
}

export interface LoginResponse {
  organizationId: string;
  name: string;
}
