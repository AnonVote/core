import {
  AnonVoteError,
  ValidationError,
  CryptoError,
  encryptVote,
  decryptVote,
  AnonVoteClient,
} from "../src/index";

const TEST_KEY = "a".repeat(64);

describe("Error hierarchy", () => {
  it("ValidationError is an instance of AnonVoteError and Error", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(AnonVoteError);
    expect(err).toBeInstanceOf(Error);
  });

  it("CryptoError is an instance of AnonVoteError and Error", () => {
    const err = new CryptoError("crypto failed");
    expect(err).toBeInstanceOf(CryptoError);
    expect(err).toBeInstanceOf(AnonVoteError);
    expect(err).toBeInstanceOf(Error);
  });

  it("error name matches class name", () => {
    expect(new ValidationError("x").name).toBe("ValidationError");
    expect(new CryptoError("x").name).toBe("CryptoError");
    expect(new AnonVoteError("x").name).toBe("AnonVoteError");
  });

  it("error message is preserved", () => {
    expect(new ValidationError("bad input").message).toBe("bad input");
    expect(new CryptoError("crypto failed").message).toBe("crypto failed");
  });
});

describe("encryptVote throws typed errors", () => {
  it("throws ValidationError for a short key", () => {
    expect(() => encryptVote("Yes", "tooshort")).toThrow(ValidationError);
  });

  it("thrown error is also an AnonVoteError", () => {
    let caught: unknown;
    try {
      encryptVote("Yes", "tooshort");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnonVoteError);
  });
});

describe("decryptVote throws typed errors", () => {
  it("throws CryptoError on tampered ciphertext", () => {
    const payload = encryptVote("Yes", TEST_KEY);
    const tampered = { ...payload, ciphertext: "00".repeat(8) };
    expect(() => decryptVote(tampered, TEST_KEY)).toThrow(CryptoError);
  });

  it("throws CryptoError on wrong key", () => {
    const payload = encryptVote("Yes", TEST_KEY);
    expect(() => decryptVote(payload, "b".repeat(64))).toThrow(CryptoError);
  });

  it("thrown CryptoError is also an AnonVoteError", () => {
    const payload = encryptVote("Yes", TEST_KEY);
    const tampered = { ...payload, authTag: "00".repeat(16) };
    let caught: unknown;
    try {
      decryptVote(tampered, TEST_KEY);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnonVoteError);
  });
});

describe("AnonVoteClient throws typed errors", () => {
  const client = new AnonVoteClient({ encryptionKey: TEST_KEY });
  const base = {
    title: "T",
    description: "D",
    options: ["A"],
    startTime: Date.now(),
    endTime: Date.now() + 1000,
  };

  it("createElection throws ValidationError for empty title", () => {
    expect(() => client.createElection({ ...base, title: "" })).toThrow(
      ValidationError,
    );
  });

  it("createElection throws ValidationError for empty options array", () => {
    expect(() => client.createElection({ ...base, options: [] })).toThrow(
      ValidationError,
    );
  });

  it("createElection throws ValidationError when endTime <= startTime", () => {
    expect(() =>
      client.createElection({ ...base, startTime: 1000, endTime: 500 }),
    ).toThrow(ValidationError);
  });

  it("castVote throws ValidationError for missing ballotId", () => {
    expect(() =>
      client.castVote({ ballotId: "", voteOption: "A", encryptionKey: TEST_KEY }),
    ).toThrow(ValidationError);
  });

  it("castVote throws ValidationError for missing voteOption", () => {
    expect(() =>
      client.castVote({ ballotId: "elec-1", voteOption: "", encryptionKey: TEST_KEY }),
    ).toThrow(ValidationError);
  });

  it("castVote throws ValidationError when no encryptionKey anywhere", () => {
    const c = new AnonVoteClient();
    expect(() =>
      c.castVote({ ballotId: "elec-1", voteOption: "A" }),
    ).toThrow(ValidationError);
  });

  it("all thrown errors are AnonVoteError instances", () => {
    let caught: unknown;
    try {
      client.createElection({ ...base, title: "" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnonVoteError);
  });
});
