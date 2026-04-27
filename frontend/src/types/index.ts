export interface Organization {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Option {
  id: string;
  text: string;
  ballotId: string;
}

export interface Ballot {
  id: string;
  topic: string;
  status: "OPEN" | "CLOSED";
  deadline: string;
  eligibilityListId: string;
  createdAt: string;
  options: Option[];
  eligibleVoters?: number;
  votesCast?: number;
  result?: Result;
}

export interface Result {
  id: string;
  ballotId: string;
  tallyJson: string;
  totalVotes: number;
  isConsistent: boolean;
  stellarTxId: string | null;
  publishedAt: string;
}

export interface TallyEntry {
  optionId: string;
  optionText: string;
  count: number;
  percentage: number;
}

export interface AuditEvent {
  eventType: string;
  stellarTxId: string | null;
  createdAt: string;
}

export interface AuditCounts {
  ballotId: string;
  tokensIssued: number;
  votesCast: number;
  events: AuditEvent[];
}

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
}
