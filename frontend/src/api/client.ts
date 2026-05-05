import axios from "axios";
import type {
  Ballot,
  Organization,
  Result,
  AuditCounts,
  ApiResponse,
} from "../types";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only redirect on 401 if there's a response (not a network error)
    if (
      err.response?.status === 401 &&
      !window.location.pathname.includes("/login")
    ) {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

// Organizations
export const registerOrg = (data: {
  name: string;
  email: string;
  password: string;
}) => api.post<ApiResponse<Organization>>("/organizations", data);

export const loginOrg = (data: { name: string; password: string }) =>
  api.post<ApiResponse<{ organizationId: string; name: string }>>(
    "/organizations/login",
    data,
  );

export const logoutOrg = () => api.post("/organizations/logout");

export const getMe = () =>
  api.get<ApiResponse<Organization>>("/organizations/me");

export const updateOrg = (data: { name?: string; email?: string }) =>
  api.patch<ApiResponse<Organization>>("/organizations/me", data);

export const changePassword = (data: {
  currentPassword: string;
  newPassword: string;
}) =>
  api.patch<ApiResponse<{ message: string }>>("/organizations/password", data);

export const deleteAccount = () =>
  api.delete<ApiResponse<{ message: string }>>("/organizations/me");

// Ballots
export const getBallots = () => api.get<ApiResponse<Ballot[]>>("/ballots");

export const getBallot = (id: string) =>
  api.get<ApiResponse<Ballot>>(`/ballots/${id}`);

export const deleteBallot = (id: string) =>
  api.delete<ApiResponse<{ message: string }>>(`/ballots/${id}`);

export const createBallot = (data: {
  topic: string;
  options: string[];
  eligibilityListId: string;
  deadline: string;
  allowWeightedVoting?: boolean;
  allowRankedChoice?: boolean;
  maxRankings?: number;
}) => api.post<ApiResponse<Ballot>>("/ballots", data);

export const updateBallot = (
  id: string,
  data: {
    topic?: string;
    deadline?: string;
    eligibilityListId?: string;
    options?: string[];
  },
) => api.patch<ApiResponse<Ballot>>(`/ballots/${id}`, data);

// Eligibility
export const uploadEligibilityList = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<ApiResponse<{ eligibilityListId: string; count: number }>>(
    "/eligibility",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
};

// Tokens
export const requestToken = (data: {
  ballotId: string;
  voterIdentifier: string;
}) => api.post<ApiResponse<{ token: string }>>("/tokens", data);

// Votes
export const submitVote = (data: {
  ballotId: string;
  voterToken: string;
  optionId: string;
  weight?: number;
}) =>
  api.post<ApiResponse<{ message: string; voteId: string; ballotId: string }>>(
    "/votes",
    data,
  );

// Results
export const getResult = (ballotId: string) =>
  api.get<ApiResponse<Result>>(`/results/${ballotId}`);

export const tallyBallot = (ballotId: string) =>
  api.post<ApiResponse<Result>>(`/results/${ballotId}/tally`);

// Audit
export const getAudit = (ballotId: string) =>
  api.get<ApiResponse<AuditCounts>>(`/audit/${ballotId}`);

// Admin
export const getRateLimitSettings = () =>
  api.get<
    ApiResponse<{
      current: { preset: string; maxAttempts: number; windowMinutes: number };
      presets: Record<
        string,
        { preset: string; maxAttempts: number; windowMinutes: number }
      >;
    }>
  >("/admin/rate-limit");

export const updateRateLimitSettings = (preset: string) =>
  api.patch<
    ApiResponse<{ preset: string; maxAttempts: number; windowMinutes: number }>
  >("/admin/rate-limit", { preset });

export default api;
