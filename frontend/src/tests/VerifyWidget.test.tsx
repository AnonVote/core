import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VerifyWidget from "../components/VerifyWidget";
import * as apiClient from "../api/client";

const BALLOT_ID = "test-ballot-id";

describe("VerifyWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the token input and submit button in idle state", () => {
    render(<VerifyWidget ballotId={BALLOT_ID} />);
    expect(screen.getByRole("heading", { name: /verify your vote/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste your voter token/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify/i })).toBeInTheDocument();
  });

  it("submit button is disabled when input is empty", () => {
    render(<VerifyWidget ballotId={BALLOT_ID} />);
    const btn = screen.getByRole("button", { name: /verify/i });
    expect(btn).toBeDisabled();
  });

  it("shows confirmation banner when API returns confirmed: true", async () => {
    vi.spyOn(apiClient, "verifyToken").mockResolvedValue({
      data: { confirmed: true },
    } as any);

    render(<VerifyWidget ballotId={BALLOT_ID} />);

    fireEvent.change(screen.getByPlaceholderText(/paste your voter token/i), {
      target: { value: "abc123def456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/your vote was recorded/i)).toBeInTheDocument(),
    );

    // Privacy: no option name or vote detail should appear
    expect(screen.queryByText(/option/i)).not.toBeInTheDocument();
  });

  it("shows rejection banner when API returns confirmed: false", async () => {
    vi.spyOn(apiClient, "verifyToken").mockResolvedValue({
      data: { confirmed: false },
    } as any);

    render(<VerifyWidget ballotId={BALLOT_ID} />);

    fireEvent.change(screen.getByPlaceholderText(/paste your voter token/i), {
      target: { value: "someunknowntoken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/no vote found for this token/i)).toBeInTheDocument(),
    );
  });

  it("shows error banner on network failure without crashing", async () => {
    vi.spyOn(apiClient, "verifyToken").mockRejectedValue(
      new Error("Network Error"),
    );

    render(<VerifyWidget ballotId={BALLOT_ID} />);

    fireEvent.change(screen.getByPlaceholderText(/paste your voter token/i), {
      target: { value: "sometoken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/unable to verify/i)).toBeInTheDocument(),
    );
  });

  it("resets to idle state when 'Check another' button is clicked", async () => {
    vi.spyOn(apiClient, "verifyToken").mockResolvedValue({
      data: { confirmed: true },
    } as any);

    render(<VerifyWidget ballotId={BALLOT_ID} />);

    fireEvent.change(screen.getByPlaceholderText(/paste your voter token/i), {
      target: { value: "sometoken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(screen.getByText(/your vote was recorded/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(/check another/i));
    expect(screen.getByPlaceholderText(/paste your voter token/i)).toBeInTheDocument();
  });
});
