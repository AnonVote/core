import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VotePage from "../pages/VotePage";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../api/client", () => ({
  getBallot: vi.fn(),
  submitVote: vi.fn(),
}));

// Mock navigate so we can assert redirect
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { getBallot, submitVote } from "../api/client";
const mockedGetBallot = getBallot as ReturnType<typeof vi.fn>;
const mockedSubmitVote = submitVote as ReturnType<typeof vi.fn>;

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BALLOT_ID = "ballot-test-123";
const VALID_TOKEN = "a".repeat(32); // 32 hex chars — passes client validation

const mockBallot = {
  id: BALLOT_ID,
  topic: "Should we adopt the new policy?",
  status: "OPEN",
  deadline: new Date(Date.now() + 3_600_000).toISOString(),
  options: [
    { id: "opt-1", ballotId: BALLOT_ID, text: "Yes" },
    { id: "opt-2", ballotId: BALLOT_ID, text: "No" },
  ],
  eligibilityListId: "list-1",
  organizationId: "org-1",
  allowWeightedVoting: false,
  allowRankedChoice: false,
  createdAt: new Date().toISOString(),
};

function renderVotePage(ballotId = BALLOT_ID, locationState?: object) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: `/vote/${ballotId}`, state: locationState }]}
    >
      <Routes>
        <Route path="/vote/:ballotId" element={<VotePage />} />
        <Route path="/results/:ballotId" element={<div>Results Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Fill the form to a submittable state
async function fillForm(token = VALID_TOKEN, optionText = "Yes") {
  const tokenInput = screen.getByTestId("token-input");
  fireEvent.change(tokenInput, { target: { value: token } });

  const option = await screen.findByText(optionText);
  fireEvent.click(option);

  const checkbox = screen.getByTestId("confirm-checkbox");
  fireEvent.click(checkbox);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  mockedGetBallot.mockResolvedValue({ data: { data: mockBallot } });
  mockedSubmitVote.mockResolvedValue({
    data: { data: { voteId: "vote-id-abc", ballotId: BALLOT_ID, message: "Vote submitted" } },
  });
  navigateMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("VotePage — rendering", () => {
  it("renders the token input field", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByTestId("token-input")).toBeInTheDocument();
    });
  });

  it("renders option selection after ballot loads", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByText("Yes")).toBeInTheDocument();
      expect(screen.getByText("No")).toBeInTheDocument();
    });
  });

  it("renders the confirmation checkbox", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByTestId("confirm-checkbox")).toBeInTheDocument();
    });
  });

  it("renders the submit button", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByTestId("submit-button")).toBeInTheDocument();
    });
  });

  it("renders a Back to Ballot link", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByTestId("back-link")).toBeInTheDocument();
    });
  });

  it("pre-fills token from navigation state", async () => {
    renderVotePage(BALLOT_ID, { token: VALID_TOKEN });
    await waitFor(() => {
      const input = screen.getByTestId("token-input") as HTMLInputElement;
      expect(input.value).toBe(VALID_TOKEN);
    });
  });
});

// ── Submit button disabled state ──────────────────────────────────────────────

describe("VotePage — submit button disabled state", () => {
  it("is disabled on initial render", async () => {
    renderVotePage();
    await waitFor(() => {
      expect(screen.getByTestId("submit-button")).toBeDisabled();
    });
  });

  it("is disabled when only token is entered", async () => {
    renderVotePage();
    await waitFor(() => screen.getByTestId("token-input"));
    fireEvent.change(screen.getByTestId("token-input"), {
      target: { value: VALID_TOKEN },
    });
    expect(screen.getByTestId("submit-button")).toBeDisabled();
  });

  it("is disabled when token + option are filled but checkbox not checked", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    fireEvent.change(screen.getByTestId("token-input"), { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByText("Yes"));
    expect(screen.getByTestId("submit-button")).toBeDisabled();
  });

  it("is disabled when token is too short (under 32 chars)", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    fireEvent.change(screen.getByTestId("token-input"), { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByTestId("confirm-checkbox"));
    expect(screen.getByTestId("submit-button")).toBeDisabled();
  });

  it("is enabled when token, option, and confirmation are all provided", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    expect(screen.getByTestId("submit-button")).not.toBeDisabled();
  });
});

// ── Client-side token validation ──────────────────────────────────────────────

describe("VotePage — client-side token validation", () => {
  it("shows format error after blur when token is too short", async () => {
    renderVotePage();
    await waitFor(() => screen.getByTestId("token-input"));

    const input = screen.getByTestId("token-input");
    fireEvent.change(input, { target: { value: "tooshort" } });
    fireEvent.blur(input);

    expect(screen.getByTestId("token-format-error")).toBeInTheDocument();
  });

  it("does not show format error for a valid 32-char hex token", async () => {
    renderVotePage();
    await waitFor(() => screen.getByTestId("token-input"));

    const input = screen.getByTestId("token-input");
    fireEvent.change(input, { target: { value: VALID_TOKEN } });
    fireEvent.blur(input);

    expect(screen.queryByTestId("token-format-error")).not.toBeInTheDocument();
  });

  it("does not show format error before the field has been touched", async () => {
    renderVotePage();
    await waitFor(() => screen.getByTestId("token-input"));
    expect(screen.queryByTestId("token-format-error")).not.toBeInTheDocument();
  });
});

// ── Successful submission ─────────────────────────────────────────────────────

describe("VotePage — successful submission", () => {
  it("shows success screen after submission", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("success-screen")).toBeInTheDocument();
    });
  });

  it("shows 'Vote Submitted' heading on success", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Vote Submitted")).toBeInTheDocument();
    });
  });

  it("shows the encrypted confirmation message", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(
        screen.getByText(/your vote has been recorded and encrypted/i),
      ).toBeInTheDocument();
    });
  });

  it("redirects to results page after 3 seconds", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => screen.getByTestId("success-screen"));

    act(() => { vi.advanceTimersByTime(3000); });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(`/results/${BALLOT_ID}`);
    });
  });

  it("shows View Results link on success screen", async () => {
    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /view results/i })).toBeInTheDocument();
    });
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("VotePage — error handling", () => {
  it("shows 409 (already voted) message", async () => {
    mockedSubmitVote.mockRejectedValueOnce({
      response: { status: 409, data: { error: "AlreadyVoted", message: "Token used" } },
    });

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("error-banner")).toHaveTextContent(
        /this token has already voted/i,
      );
    });
  });

  it("shows 401 (invalid token) message", async () => {
    mockedSubmitVote.mockRejectedValueOnce({
      response: { status: 401, data: { error: "INVALID_TOKEN", message: "Bad token" } },
    });

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("error-banner")).toHaveTextContent(
        /this token is not valid for this ballot/i,
      );
    });
  });

  it("shows 403 (ballot closed) message", async () => {
    mockedSubmitVote.mockRejectedValueOnce({
      response: { status: 403, data: { error: "BALLOT_CLOSED", message: "Closed" } },
    });

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("error-banner")).toHaveTextContent(
        /voting for this ballot has closed/i,
      );
    });
  });

  it("shows network error message when there is no response", async () => {
    mockedSubmitVote.mockRejectedValueOnce(new Error("Network Error"));

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("error-banner")).toHaveTextContent(
        /unable to reach the server/i,
      );
    });
  });

  it("shows a retry button on network errors", async () => {
    mockedSubmitVote.mockRejectedValueOnce(new Error("Network Error"));

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("retry-button")).toBeInTheDocument();
    });
  });

  it("does not show retry button on non-network errors (e.g. 409)", async () => {
    mockedSubmitVote.mockRejectedValueOnce({
      response: { status: 409, data: { error: "AlreadyVoted" } },
    });

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => screen.getByTestId("error-banner"));
    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();
  });

  it("clears the error when retry button is clicked", async () => {
    mockedSubmitVote.mockRejectedValueOnce(new Error("Network Error"));

    renderVotePage();
    await waitFor(() => screen.getByText("Yes"));
    await fillForm();
    fireEvent.submit(screen.getByTestId("submit-button").closest("form")!);

    await waitFor(() => screen.getByTestId("retry-button"));
    fireEvent.click(screen.getByTestId("retry-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
    });
  });
});
