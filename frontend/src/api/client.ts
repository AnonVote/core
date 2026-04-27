import axios from "axios";
import type {
  Ballot,
  Organization,
  Result,
  AuditCounts,
  ApiResponse,
} from "../types";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
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

// Ballots
export const getBallots = () => api.get<ApiResponse<Ballot[]>>("/ballots");

export const getBallot = (id: string) =>
  api.get<ApiResponse<Ballot>>(`/ballots/${id}`);

export const createBallot = (data: {
  topic: string;
  options: string[];
  eligibilityListId: string;
  deadline: string;
}) => api.post<ApiResponse<Ballot>>("/ballots", data);

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
}) =>
  api.post<ApiResponse<{ message: string; voteId: string; ballotId: string }>>(
    "/votes",
    data,
  );

// Results
export const getResult = (ballotId: string) =>
  api.get<ApiResponse<Result>>(`/results/${ballotId}`);

// Audit
export const getAudit = (ballotId: string) =>
  api.get<ApiResponse<AuditCounts>>(`/audit/${ballotId}`);

export default api;
