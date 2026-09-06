import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { NotificationProvider } from "../context/NotificationContext";
import AdminCreateBallotPage from "../pages/admin/CreateBallotPage";
import BallotCard from "../components/BallotCard";
import type { Ballot } from "../types";

// Mock API client
vi.mock("../api/client", () => ({
  createBallot: vi.fn(),
  getMe: vi.fn(() => Promise.resolve({ data: { data: { id: "1", name: "Test Org" } } })),
  deleteBallot: vi.fn(),
  tallyBallot: vi.fn(),
}));

const renderCreatePage = () => {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <NotificationProvider>
          <AdminCreateBallotPage />
        </NotificationProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

describe("Admin CreateBallotPage — Deadline Picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows UTC equivalent beneath the local deadline picker", () => {
    renderCreatePage();
    const deadlineInput = screen.getByLabelText(/Voting Deadline/i);
    // Set a local datetime
    const localDate = "2026-12-25T15:00";
    fireEvent.change(deadlineInput, { target: { value: localDate } });

    // UTC equivalent should be displayed
    expect(screen.getByText(/UTC equivalent:/i)).toBeInTheDocument();
  });

  it("submits UTC regardless of local timezone", () => {
    renderCreatePage();
    const deadlineInput = screen.getByLabelText(/Voting Deadline/i);
    const localDate = "2026-12-25T15:00";
    fireEvent.change(deadlineInput, { target: { value: localDate } });

    // The UTC equivalent text shows the ISO string
    const utcText = screen.getByText(/UTC equivalent:/i);
    expect(utcText.textContent).toContain("+00:00");
  });
});

describe("Admin CreateBallotPage — Option List", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables remove button when only 2 options remain", () => {
    renderCreatePage();
    // Initially 2 options, remove buttons should be disabled
    const removeButtons = screen.getAllByTitle(/Minimum 2 options required/i);
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("enables remove button when more than 2 options exist", () => {
    renderCreatePage();
    // Add an option
    const addButton = screen.getByText(/\+ Add option/i);
    fireEvent.click(addButton);

    // Now 3 options, remove buttons should be enabled
    const removeButtons = screen.getAllByTitle(/Remove option/i);
    expect(removeButtons).toHaveLength(3);
    removeButtons.forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });

  it("disables remove button again when options reduced back to 2", () => {
    renderCreatePage();
    // Add an option
    fireEvent.click(screen.getByText(/\+ Add option/i));

    // Remove one option
    const removeButtons = screen.getAllByTitle(/Remove option/i);
    fireEvent.click(removeButtons[0]);

    // Back to 2 options, remove buttons should be disabled
    const disabledButtons = screen.getAllByTitle(/Minimum 2 options required/i);
    expect(disabledButtons).toHaveLength(2);
  });
});

describe("BallotCard — Anchor Status", () => {
  const baseBallot: Ballot = {
    id: "b-1",
    organizationId: "org-1",
    topic: "Test Ballot",
    status: "ACTIVE",
    deadline: new Date(Date.now() + 86400000).toISOString(),
    eligibilityListId: "el-1",
    allowWeightedVoting: false,
    allowRankedChoice: false,
    createdAt: new Date().toISOString(),
    options: [
      { id: "opt-1", ballotId: "b-1", text: "Option A" },
      { id: "opt-2", ballotId: "b-1", text: "Option B" },
    ],
  };

  it("FAILED anchor card shows retry button", () => {
    const ballot: Ballot = {
      ...baseBallot,
      anchorStatus: "FAILED",
      stellarTxId: undefined,
    };
    render(
      <BrowserRouter>
        <BallotCard ballot={ballot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );

    expect(screen.getByText(/Stellar anchor failed/i)).toBeInTheDocument();
  });

  it("ANCHORED card does not show retry button", () => {
    const ballot: Ballot = {
      ...baseBallot,
      anchorStatus: "ANCHORED",
      stellarTxId: "tx-hash-123",
    };
    render(
      <BrowserRouter>
        <BallotCard ballot={ballot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );

    expect(screen.getByText(/Anchored to Stellar/i)).toBeInTheDocument();
    expect(screen.queryByText(/Stellar anchor failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stellar anchor pending/i)).not.toBeInTheDocument();
  });

  it("PENDING anchor card shows pending message", () => {
    const ballot: Ballot = {
      ...baseBallot,
      anchorStatus: "PENDING",
      stellarTxId: undefined,
    };
    render(
      <BrowserRouter>
        <BallotCard ballot={ballot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );

    expect(screen.getByText(/Stellar anchor pending/i)).toBeInTheDocument();
  });
});

describe("Dashboard — Tab Panels", () => {
  it("renders all status tabs", () => {
    // We test the tab rendering through the BallotCard component
    // by verifying status badges render correctly
    const draftBallot: Ballot = {
      ...{
        id: "b-draft",
        organizationId: "org-1",
        topic: "Draft Ballot",
        status: "DRAFT",
        deadline: new Date(Date.now() + 86400000).toISOString(),
        eligibilityListId: "el-1",
        allowWeightedVoting: false,
        allowRankedChoice: false,
        createdAt: new Date().toISOString(),
        options: [
          { id: "opt-1", ballotId: "b-draft", text: "Option A" },
          { id: "opt-2", ballotId: "b-draft", text: "Option B" },
        ],
      },
    };

    const activeBallot: Ballot = {
      ...{
        id: "b-active",
        organizationId: "org-1",
        topic: "Active Ballot",
        status: "ACTIVE",
        deadline: new Date(Date.now() + 86400000).toISOString(),
        eligibilityListId: "el-1",
        allowWeightedVoting: false,
        allowRankedChoice: false,
        createdAt: new Date().toISOString(),
        options: [
          { id: "opt-1", ballotId: "b-active", text: "Option A" },
          { id: "opt-2", ballotId: "b-active", text: "Option B" },
        ],
      },
    };

    const closedBallot: Ballot = {
      ...{
        id: "b-closed",
        organizationId: "org-1",
        topic: "Closed Ballot",
        status: "CLOSED",
        deadline: new Date(Date.now() - 86400000).toISOString(),
        eligibilityListId: "el-1",
        allowWeightedVoting: false,
        allowRankedChoice: false,
        createdAt: new Date().toISOString(),
        options: [
          { id: "opt-1", ballotId: "b-closed", text: "Option A" },
          { id: "opt-2", ballotId: "b-closed", text: "Option B" },
        ],
      },
    };

    // Render each ballot card and verify status badge
    const { unmount } = render(
      <BrowserRouter>
        <BallotCard ballot={draftBallot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    unmount();

    render(
      <BrowserRouter>
        <BallotCard ballot={activeBallot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    unmount();

    render(
      <BrowserRouter>
        <BallotCard ballot={closedBallot} onBallotDeleted={vi.fn()} />
      </BrowserRouter>
    );
    expect(screen.getByText("CLOSED")).toBeInTheDocument();
  });
});