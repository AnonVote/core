import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface BallotResult {
  ballotId: string;
  title: string;
  description: string;
  deadline: string;
  status: string;
  tally: { option: string; votes: number }[];
  stellarTxHash: string;
}

export const fetchBallotResults = async (ballotId: string): Promise<BallotResult> => {
  const response = await axios.get(`${API_BASE}/ballots/${ballotId}/results`);
  return response.data;
};
