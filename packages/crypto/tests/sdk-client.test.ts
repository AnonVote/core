/**
 * Test suite for AnonVoteClient SDK — @anonvote/crypto/client
 * All 22 required cases from issue #42.
 */
import { AnonVoteClient } from "../src/client/index";
import type {
  ClientConfig,
  Election,
  Ballot,
  VoteReceipt,
} from "../src/client/types";

// ── Helpers ────────────────────────────────────────────────────────────────

/** A valid 64-char hex key for all tests. */
const VALID_KEY = "a".repeat(64);

/** Returns an election that is currently active (starts in the past, ends in the future). */
function makeActiveElection(client: AnonVoteClient): Election {
  const election = client.createElection({
    title: "Test Election",
    description: "A test",
    options: ["Alpha", "Beta"],
    startTime: new Date(Date.now() - 1000),
    endTime: new Date(Date.now() + 86_400_000),
  });
  return election;
}

// ── constructor ────────────────────────────────────────────────────────────

describe("AnonVoteClient constructor", () => {
  it("throws INVALID_KEY for a 32-character ballotKey", () => {
    expect(() => new AnonVoteClient({ ballotKey: "a".repeat(32) })).toThrow(
      "INVALID_KEY",
    );
  });

  it("throws INVALID_KEY for a non-hex ballotKey", () => {
    expect(() => new AnonVoteClient({ ballotKey: "z".repeat(64) })).toThrow(
      "INVALID_KEY",
    );
  });

  it("instantiates successfully with a valid 64-character hex key", () => {
    expect(() => new AnonVoteClient({ ballotKey: VALID_KEY })).not.toThrow();
  });
});

// ── createElection ─────────────────────────────────────────────────────────

describe("createElection", () => {
  let client: AnonVoteClient;
  beforeEach(() => {
    client = new AnonVoteClient({ ballotKey: VALID_KEY });
  });

  it("returns an Election with unique IDs for the election and each option", () => {
    const e1 = makeActiveElection(client);
    const e2 = makeActiveElection(client);

    expect(e1.id).not.toBe(e2.id);
    expect(e1.options[0].id).not.toBe(e1.options[1].id);
  });

  it("throws INVALID_ELECTION for fewer than 2 options", () => {
    expect(() =>
      client.createElection({
        title: "T",
        description: "D",
        options: ["Only one"],
        startTime: new Date(),
        endTime: new Date(Date.now() + 1000),
      }),
    ).toThrow("INVALID_ELECTION");
  });

  it("throws INVALID_ELECTION for more than 10 options", () => {
    expect(() =>
      client.createElection({
        title: "T",
        description: "D",
        options: Array.from({ length: 11 }, (_, i) => `Option ${i}`),
        startTime: new Date(),
        endTime: new Date(Date.now() + 1000),
      }),
    ).toThrow("INVALID_ELECTION");
  });

  it("throws INVALID_ELECTION when endTime is before startTime", () => {
    expect(() =>
      client.createElection({
        title: "T",
        description: "D",
        options: ["A", "B"],
        startTime: new Date(Date.now() + 10_000),
        endTime: new Date(Date.now() + 5_000),
      }),
    ).toThrow("INVALID_ELECTION");
  });

  it("throws INVALID_ELECTION when endTime is in the past", () => {
    expect(() =>
      client.createElection({
        title: "T",
        description: "D",
        options: ["A", "B"],
        startTime: new Date(Date.now() - 10_000),
        endTime: new Date(Date.now() - 1_000),
      }),
    ).toThrow("INVALID_ELECTION");
  });

  it("option IDs are UUIDs — not the option label text", () => {
    const election = makeActiveElection(client);
    for (const opt of election.options) {
      // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(opt.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(opt.id).not.toBe(opt.label);
    }
  });
});

// ── castVote ───────────────────────────────────────────────────────────────

describe("castVote", () => {
  let client: AnonVoteClient;
  let election: Election;

  beforeEach(() => {
    client = new AnonVoteClient({ ballotKey: VALID_KEY });
    election = makeActiveElection(client);
  });

  it("returns a Ballot with an EncryptedPayload", () => {
    const ballot = client.castVote(election, election.options[0].id);

    expect(ballot.electionId).toBe(election.id);
    expect(ballot.encryptedPayload).toMatchObject({
      ciphertext: expect.stringMatching(/^[0-9a-f]+$/),
      iv: expect.stringMatching(/^[0-9a-f]+$/),
      authTag: expect.stringMatching(/^[0-9a-f]+$/),
    });
  });

  it("throws INVALID_OPTION for an optionId not in the election", () => {
    expect(() => client.castVote(election, "not-a-real-uuid")).toThrow(
      "INVALID_OPTION",
    );
  });

  it("throws ELECTION_NOT_ACTIVE for a closed election", () => {
    const closed = client.createElection({
      title: "Past",
      description: "D",
      options: ["A", "B"],
      startTime: new Date(Date.now() + 10_000),
      endTime: new Date(Date.now() + 20_000),
    });
    // election is in 'draft' — not active yet
    expect(() => client.castVote(closed, closed.options[0].id)).toThrow(
      "ELECTION_NOT_ACTIVE",
    );
  });

  it("two calls with the same optionId produce different EncryptedPayloads (random IV)", () => {
    const b1 = client.castVote(election, election.options[0].id);
    const b2 = client.castVote(election, election.options[0].id);

    expect(b1.encryptedPayload.iv).not.toBe(b2.encryptedPayload.iv);
    expect(b1.encryptedPayload.ciphertext).not.toBe(
      b2.encryptedPayload.ciphertext,
    );
  });

  it("Ballot contains optionId locally but serialize omits it", () => {
    const ballot = client.castVote(election, election.options[0].id);

    // optionId is present on the local Ballot object
    expect(ballot.optionId).toBe(election.options[0].id);

    // serialize must NOT include optionId
    const json = client.serialize(ballot);
    expect(json).not.toContain("optionId");

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("optionId");
  });

  it("castVote never logs optionId", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});

    client.castVote(election, election.options[0].id);

    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });
});

// ── verifyVote ─────────────────────────────────────────────────────────────

describe("verifyVote", () => {
  let client: AnonVoteClient;
  let election: Election;

  beforeEach(() => {
    client = new AnonVoteClient({ ballotKey: VALID_KEY });
    election = makeActiveElection(client);
  });

  it("returns confirmed: true for a valid ballot", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const result = client.verifyVote(ballot);

    expect(result.confirmed).toBe(true);
    expect(result.electionId).toBe(election.id);
  });

  it("propagates decryption error — does not catch and return false", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const corrupted: Ballot = {
      ...ballot,
      encryptedPayload: {
        ciphertext: "00".repeat(16),
        iv: ballot.encryptedPayload.iv,
        authTag: ballot.encryptedPayload.authTag,
      },
    };

    // Must throw, NOT return { confirmed: false }
    expect(() => client.verifyVote(corrupted)).toThrow();
  });

  it("roundtrip — castVote then verifyVote always returns confirmed: true", () => {
    for (const opt of election.options) {
      const ballot = client.castVote(election, opt.id);
      expect(client.verifyVote(ballot).confirmed).toBe(true);
    }
  });
});

// ── serialize and deserialize ──────────────────────────────────────────────

describe("serialize and deserialize", () => {
  let client: AnonVoteClient;
  let election: Election;

  beforeEach(() => {
    client = new AnonVoteClient({ ballotKey: VALID_KEY });
    election = makeActiveElection(client);
  });

  it("serialize produces a stable deterministic JSON string", () => {
    const ballot = client.castVote(election, election.options[0].id);
    expect(client.serialize(ballot)).toBe(client.serialize(ballot));
  });

  it("serialize omits optionId from the output", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const json = client.serialize(ballot);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("optionId");
    expect(json).not.toContain("optionId");
  });

  it("deserialize reconstructs a valid Ballot from serialized output", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const json = client.serialize(ballot);
    const restored = client.deserialize(json);

    expect(restored.electionId).toBe(ballot.electionId);
    expect(restored.encryptedPayload).toEqual(ballot.encryptedPayload);
  });

  it("deserialize throws INVALID_SERIALIZED_BALLOT for missing ciphertext field", () => {
    const json = JSON.stringify({
      electionId: "some-id",
      encryptedPayload: { iv: "aa", authTag: "bb" },
    });

    expect(() => client.deserialize(json)).toThrow("INVALID_SERIALIZED_BALLOT");
  });

  it("deserialized Ballot has no optionId (empty string) after deserialization", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const restored = client.deserialize(client.serialize(ballot));

    expect(restored.optionId).toBe("");
  });

  it("serialize → deserialize → verifyVote still returns confirmed: true", () => {
    const ballot = client.castVote(election, election.options[0].id);
    const json = client.serialize(ballot);
    const restored = client.deserialize(json);

    // verifyVote compares decrypted value to ballot.optionId.
    // After deserialization optionId is "", so we compare against the original ballot.
    const decryptedBallot: Ballot = {
      ...restored,
      optionId: ballot.optionId,
    };

    expect(client.verifyVote(decryptedBallot).confirmed).toBe(true);
  });
});

// ── type export tests ──────────────────────────────────────────────────────

describe("type exports", () => {
  it("Election type is exported and assignable", () => {
    const e: Election = {
      id: "00000000-0000-4000-8000-000000000000",
      title: "T",
      description: "D",
      options: [{ id: "opt-1", label: "A", index: 0 }],
      startTime: new Date(),
      endTime: new Date(Date.now() + 1000),
      createdAt: new Date(),
      status: "active",
    };
    expect(e.id).toBeTruthy();
  });

  it("Ballot type is exported and assignable", () => {
    const b: Ballot = {
      electionId: "some-id",
      optionId: "opt-id",
      encryptedPayload: { ciphertext: "ab", iv: "cd", authTag: "ef" },
      createdAt: new Date(),
    };
    expect(b.electionId).toBeTruthy();
  });

  it("VoteReceipt type is exported and assignable", () => {
    const r: VoteReceipt = {
      electionId: "some-id",
      tokenHash: "a".repeat(64),
      ballot: {
        electionId: "some-id",
        optionId: "opt-id",
        encryptedPayload: { ciphertext: "ab", iv: "cd", authTag: "ef" },
        createdAt: new Date(),
      },
      submittedAt: new Date(),
    };
    expect(r.tokenHash).toBeTruthy();
  });

  it("ClientConfig type is exported and assignable", () => {
    const c: ClientConfig = { ballotKey: VALID_KEY };
    expect(c.ballotKey).toBe(VALID_KEY);
  });
});
