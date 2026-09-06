import {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptVote,
  decryptVote,
} from "../utils/crypto";

const TEST_KEY = "a".repeat(64); // 32-byte hex key for testing

describe("hashIdentifier", () => {
  it("returns a 64-char hex string", () => {
    const result = hashIdentifier("test@example.com");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(hashIdentifier("user@org.com")).toBe(hashIdentifier("user@org.com"));
  });

  it("normalises case and whitespace", () => {
    expect(hashIdentifier("User@Org.com")).toBe(hashIdentifier("user@org.com"));
    expect(hashIdentifier("  user@org.com  ")).toBe(
      hashIdentifier("user@org.com"),
    );
  });

  it("produces different hashes for different inputs", () => {
    expect(hashIdentifier("a@b.com")).not.toBe(hashIdentifier("c@d.com"));
  });
});

describe("generateToken", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
  });
});

describe("hashToken", () => {
  it("returns a 64-char hex string", () => {
    expect(hashToken("abc123")).toHaveLength(64);
  });

  it("is deterministic", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("raw token cannot be derived from hash", () => {
    const raw = generateToken();
    const hash = hashToken(raw);
    expect(hash).not.toContain(raw);
  });
});

describe("encryptVote / decryptVote", () => {
  it("round-trips correctly", () => {
    const optionId = "option-uuid-1234";
    const encrypted = encryptVote(optionId, TEST_KEY);
    const decrypted = decryptVote(encrypted, TEST_KEY);
    expect(decrypted).toBe(optionId);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptVote("opt-1", TEST_KEY);
    const b = encryptVote("opt-1", TEST_KEY);
    expect(a).not.toBe(b);
  });

  it("throws on tampered payload", () => {
    const encrypted = encryptVote("opt-1", TEST_KEY);
    const parts = encrypted.split(":");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decryptVote(parts.join(":"), TEST_KEY)).toThrow();
  });

  it("throws on wrong key", () => {
    const encrypted = encryptVote("opt-1", TEST_KEY);
    const wrongKey = "b".repeat(64);
    expect(() => decryptVote(encrypted, wrongKey)).toThrow();
  });
});
