import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TokenDisplay from "../components/TokenDisplay";

// Mock clipboard API
const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: writeTextMock },
  writable: true,
});

// Mock useNavigate
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderTokenDisplay(token = "abc123token", ballotId = "ballot-1") {
  return render(
    <MemoryRouter>
      <TokenDisplay token={token} ballotId={ballotId} />
    </MemoryRouter>,
  );
}

describe("TokenDisplay", () => {
  beforeEach(() => {
    writeTextMock.mockClear();
    navigateMock.mockClear();
  });

  it("renders the token truncated in the box", () => {
    renderTokenDisplay("abc123token");
    expect(screen.getByText("abc123token")).toBeInTheDocument();
  });

  it("renders the copy button with correct aria-label", () => {
    renderTokenDisplay();
    const copyBtn = screen.getByRole("button", { name: /copy token/i });
    expect(copyBtn).toBeInTheDocument();
  });

  it("renders the Proceed to Vote button", () => {
    renderTokenDisplay();
    expect(
      screen.getByRole("button", { name: /proceed to vote/i }),
    ).toBeInTheDocument();
  });

  it("copies token to clipboard when copy button is clicked", async () => {
    renderTokenDisplay("mytoken123");
    const copyBtn = screen.getByRole("button", { name: /copy token/i });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("mytoken123");
    });
  });

  it("shows toast after copying", async () => {
    renderTokenDisplay("mytoken123");
    const copyBtn = screen.getByRole("button", { name: /copy token/i });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText(/token copied/i)).toBeInTheDocument();
    });
  });

  it("navigates to vote page with token state when Proceed is clicked", async () => {
    renderTokenDisplay("mytoken123", "ballot-42");
    const proceedBtn = screen.getByRole("button", { name: /proceed to vote/i });
    fireEvent.click(proceedBtn);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/vote/ballot-42", {
        state: { token: "mytoken123" },
      });
    });
  });

  it("shows security warning message", () => {
    renderTokenDisplay();
    expect(screen.getByText(/save this token/i)).toBeInTheDocument();
  });
});
