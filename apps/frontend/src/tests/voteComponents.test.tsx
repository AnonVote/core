import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VoteConfirmation from "../components/VoteConfirmation";
import VoteError from "../components/VoteError";
import VotePage from "../pages/VotePage";
import { ThemeProvider } from "../context/ThemeContext";
import { NotificationProvider } from "../context/NotificationContext";

// Mock API client for VotePage tests
vi.mock("../api/client", () => ({
  getBallot: vi.fn().mockResolvedValue({
    data: {
      data: {
        id: "b-123",
        topic: "Test Ballot Topic",
        status: "OPEN",
        options: [
          { id: "opt-1", text: "Option One" },
          { id: "opt-2", text: "Option Two" },
        ],
      },
    },
  }),
  submitVote: vi.fn(),
}));

describe("VoteConfirmation Component", () => {
  it("renders transaction ID, explorer link, and copy button when anchor_status is ANCHORED", () => {
    const txId = "abc123def456789stellar";
    const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txId}`;

    render(
      <VoteConfirmation
        stellar_tx_id={txId}
        anchor_status="ANCHORED"
        explorer_url={explorerUrl}
        ballotId="b-123"
      />
    );

    expect(screen.getByText("ANCHORED")).toBeInTheDocument();
    expect(screen.getByText(txId)).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();

    const link = screen.getByText("View on Stellar Expert");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe(explorerUrl);
  });

  it("renders pending message without broken link when anchor_status is PENDING", () => {
    render(
      <VoteConfirmation
        stellar_tx_id={null}
        anchor_status="PENDING"
        explorer_url={null}
        ballotId="b-123"
      />
    );

    expect(
      screen.getByText(/Your vote was recorded\. Stellar anchoring is in progress\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/transaction ID will be available shortly/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("View on Stellar Expert")).not.toBeInTheDocument();
    expect(screen.queryByText("ANCHORED")).not.toBeInTheDocument();
  });
});

describe("VoteError Component", () => {
  it("renders correct message and recovery action for INVALID_TOKEN", () => {
    render(<VoteError errorCode="INVALID_TOKEN" ballotId="b-123" />);

    expect(
      screen.getByText("This token is not recognised for this ballot.")
    ).toBeInTheDocument();
    const action = screen.getByText("Request a New Token");
    expect(action).toBeInTheDocument();
    expect(action.getAttribute("href")).toContain("/tokens");
  });

  it("renders correct message and recovery action for TOKEN_ALREADY_USED", () => {
    render(<VoteError errorCode="TOKEN_ALREADY_USED" ballotId="b-123" />);

    expect(
      screen.getByText("This token has already been used to cast a vote.")
    ).toBeInTheDocument();
    const action = screen.getByText("View Ballot Results");
    expect(action).toBeInTheDocument();
    expect(action.getAttribute("href")).toContain("/results/b-123");
  });

  it("renders correct message and recovery action for BALLOT_CLOSED", () => {
    render(<VoteError errorCode="BALLOT_CLOSED" ballotId="b-123" />);

    expect(
      screen.getByText("This ballot has closed and is no longer accepting votes.")
    ).toBeInTheDocument();
    const action = screen.getByText("View Final Results");
    expect(action).toBeInTheDocument();
    expect(action.getAttribute("href")).toContain("/results/b-123");
  });

  it("renders correct message and retry button for NETWORK_ERROR", () => {
    const onRetry = vi.fn();
    render(<VoteError errorCode="NETWORK_ERROR" onRetry={onRetry} />);

    expect(
      screen.getByText("Something went wrong. Your vote was not submitted. Please try again.")
    ).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Try Again" });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("VotePage Token Format Validation", () => {
  it("shows inline error on blur for invalid token format without network submission", async () => {
    render(
      <NotificationProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/vote/b-123"]}>
            <Routes>
              <Route path="/vote/:ballotId" element={<VotePage />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </NotificationProvider>
    );

    // Wait for ballot topic to load
    await screen.findByText("Test Ballot Topic");

    const tokenInput = screen.getByPlaceholderText("Paste your token here");

    // Enter short/invalid hex token
    fireEvent.change(tokenInput, { target: { value: "invalid-short-token" } });
    fireEvent.blur(tokenInput);

    expect(
      screen.getByTestId("token-inline-error")
    ).toHaveTextContent("Invalid token format. Token must be a 64-character hexadecimal string.");
  });
});
