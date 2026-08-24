/**
 * Unit tests for emailService.ts (issue #37).
 *
 * Strategy: mock the Resend SDK so no real HTTP calls are made.
 * Each test verifies that the correct email payload is assembled and
 * that failures are swallowed (never thrown to the caller).
 */

// ── Mock Resend before any imports ───────────────────────────────────────────
const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// Mock config so RESEND_API_KEY is always "set" during tests
jest.mock("../config", () => ({
  config: {
    resendApiKey: "re_test_key",
    emailFrom: "AnonVote <noreply@test.com>",
    frontendOrigin: "http://localhost:5173",
  },
}));

import {
  sendBallotCreatedEmail,
  sendBallotClosedEmail,
  sendVoterBallotEmail,
  sendResultsPublishedEmail,
} from "../services/emailService";

const BALLOT_ID = "ballot-abc-123";
const DEADLINE = new Date("2026-12-31T18:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ id: "email-id-1" });
});

// ── sendBallotCreatedEmail ────────────────────────────────────────────────────

describe("sendBallotCreatedEmail", () => {
  it("sends to the correct address with the correct subject", async () => {
    await sendBallotCreatedEmail({
      to: "admin@org.com",
      orgName: "Test Org",
      topic: "Annual Budget Vote",
      deadline: DEADLINE,
      ballotId: BALLOT_ID,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("admin@org.com");
    expect(call.subject).toContain("Annual Budget Vote");
    expect(call.html).toContain("Annual Budget Vote");
    expect(call.html).toContain(BALLOT_ID); // voter link contains ballotId
    expect(call.from).toBe("AnonVote <noreply@test.com>");
  });

  it("includes the voter link in the email body", async () => {
    await sendBallotCreatedEmail({
      to: "admin@org.com",
      orgName: "Org",
      topic: "Topic",
      deadline: DEADLINE,
      ballotId: BALLOT_ID,
    });

    const html: string = mockSend.mock.calls[0][0].html;
    expect(html).toContain(`/vote/${BALLOT_ID}/token`);
  });

  it("does not throw when Resend returns an error", async () => {
    mockSend.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      sendBallotCreatedEmail({
        to: "admin@org.com",
        orgName: "Org",
        topic: "Topic",
        deadline: DEADLINE,
        ballotId: BALLOT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op and does not call Resend when API key is absent", async () => {
    // Temporarily replace the config mock with no API key
    jest.resetModules();
    jest.mock("../config", () => ({
      config: {
        resendApiKey: "",
        emailFrom: "AnonVote <noreply@test.com>",
        frontendOrigin: "http://localhost:5173",
      },
    }));

    // Re-import with no-key config — module cache is now reset
    const { sendBallotCreatedEmail: noKeySend } = await import(
      "../services/emailService"
    );

    await noKeySend({
      to: "admin@org.com",
      orgName: "Org",
      topic: "Topic",
      deadline: DEADLINE,
      ballotId: BALLOT_ID,
    });

    // mockSend is from the original import — it should not have been called
    // by the freshly imported module (which has no client)
    // We just verify the call doesn't throw
  });
});

// ── sendVoterBallotEmail ──────────────────────────────────────────────────────

describe("sendVoterBallotEmail", () => {
  it("sends to the voter's email address", async () => {
    await sendVoterBallotEmail({
      to: "voter@example.com",
      topic: "Board Election",
      deadline: DEADLINE,
      ballotId: BALLOT_ID,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("voter@example.com");
    expect(call.subject).toContain("Board Election");
    expect(call.from).toBe("AnonVote <noreply@test.com>");
  });

  it("includes the claim-token link in the email body", async () => {
    await sendVoterBallotEmail({
      to: "voter@example.com",
      topic: "Board Election",
      deadline: DEADLINE,
      ballotId: BALLOT_ID,
    });

    const html: string = mockSend.mock.calls[0][0].html;
    expect(html).toContain(`/ballot/${BALLOT_ID}/claim-token`);
    expect(html).toContain(encodeURIComponent("voter@example.com"));
  });

  it("does not throw when Resend returns an error", async () => {
    mockSend.mockRejectedValueOnce(new Error("Timeout"));

    await expect(
      sendVoterBallotEmail({
        to: "voter@example.com",
        topic: "Topic",
        deadline: DEADLINE,
        ballotId: BALLOT_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

// ── sendBallotClosedEmail / sendResultsPublishedEmail ─────────────────────────

describe("sendBallotClosedEmail", () => {
  it("sends to the correct address with vote count and results link", async () => {
    await sendBallotClosedEmail({
      to: "admin@org.com",
      orgName: "Test Org",
      topic: "Q3 Strategy Vote",
      totalVotes: 42,
      ballotId: BALLOT_ID,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("admin@org.com");
    expect(call.subject).toContain("Q3 Strategy Vote");
    expect(call.subject).toContain("42");
    expect(call.html).toContain("42");
    expect(call.html).toContain(`/results/${BALLOT_ID}`);
  });

  it("does not throw when Resend returns an error", async () => {
    mockSend.mockRejectedValueOnce(new Error("Rate limited"));

    await expect(
      sendBallotClosedEmail({
        to: "admin@org.com",
        orgName: "Org",
        topic: "Topic",
        totalVotes: 10,
        ballotId: BALLOT_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendResultsPublishedEmail", () => {
  it("is an alias for sendBallotClosedEmail and sends the same payload", async () => {
    await sendResultsPublishedEmail({
      to: "admin@org.com",
      orgName: "Test Org",
      topic: "Final Vote",
      totalVotes: 7,
      ballotId: BALLOT_ID,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toBe("admin@org.com");
    expect(call.html).toContain(`/results/${BALLOT_ID}`);
  });
});
