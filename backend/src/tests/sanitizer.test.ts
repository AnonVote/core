import {
  REDACTED,
  isEmail,
  redactValue,
  sanitizeQuery,
  sanitizeHeaders,
  sanitizePath,
  anonymize,
} from "../utils/sanitizer";

describe("isEmail", () => {
  it("detects email addresses", () => {
    expect(isEmail("user@example.com")).toBe(true);
    expect(isEmail("first.last+tag@sub.domain.org")).toBe(true);
  });

  it("rejects non-email strings", () => {
    expect(isEmail("not-an-email")).toBe(false);
    expect(isEmail("user@example")).toBe(false);
    expect(isEmail("plaintext")).toBe(false);
  });
});

describe("redactValue", () => {
  it("redacts email addresses", () => {
    expect(redactValue("user@example.com")).toBe(REDACTED);
  });

  it("redacts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature";
    expect(redactValue(jwt)).toBe(REDACTED);
  });

  it("leaves ordinary values untouched", () => {
    expect(redactValue("ballot-123")).toBe("ballot-123");
    expect(redactValue("ACTIVE")).toBe("ACTIVE");
  });
});

describe("sanitizeQuery", () => {
  it("redacts values of sensitive keys", () => {
    const query = {
      email: "user@example.com",
      token: "abc123",
      password: "s3cret",
      api_key: "key-123",
    };
    const result = sanitizeQuery(query as any);
    expect(result.email).toBe(REDACTED);
    expect(result.token).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
    expect(result.api_key).toBe(REDACTED);
  });

  it("redacts email and JWT values even under non-sensitive keys", () => {
    const result = sanitizeQuery({ contact: "user@example.com" } as any);
    expect(result.contact).toBe(REDACTED);
  });

  it("preserves safe query parameters", () => {
    const result = sanitizeQuery({ ballotId: "b-123", page: "2" } as any);
    expect(result.ballotId).toBe("b-123");
    expect(result.page).toBe("2");
  });

  it("redacts non-string values", () => {
    const result = sanitizeQuery({ nested: { a: 1 } } as any);
    expect(result.nested).toBe(REDACTED);
  });

  it("handles array values", () => {
    const result = sanitizeQuery({ ids: ["a", "b"] } as any);
    expect(result.ids).toBe('["a","b"]');
  });
});

describe("sanitizeHeaders", () => {
  it("redacts sensitive headers", () => {
    const headers = {
      authorization: "Bearer some-token",
      cookie: "session=abc",
      "x-api-key": "secret",
    };
    const result = sanitizeHeaders(headers);
    expect(result.authorization).toBe(REDACTED);
    expect(result.cookie).toBe(REDACTED);
    expect(result["x-api-key"]).toBe(REDACTED);
  });

  it("preserves safe headers", () => {
    const headers = {
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
      accept: "application/json",
    };
    const result = sanitizeHeaders(headers);
    expect(result["user-agent"]).toBe("Mozilla/5.0");
    expect(result["content-type"]).toBe("application/json");
    expect(result.accept).toBe("application/json");
  });

  it("redacts email-like header values", () => {
    const result = sanitizeHeaders({ "x-custom": "user@example.com" });
    expect(result["x-custom"]).toBe(REDACTED);
  });
});

describe("sanitizePath", () => {
  it("returns the path unchanged when no query is present", () => {
    expect(sanitizePath("/api/votes", {})).toBe("/api/votes");
  });

  it("appends a redacted query string", () => {
    const path = sanitizePath("/api/ballots", {
      email: REDACTED,
      page: "2",
    });
    expect(path).toBe("/api/ballots?email=%5BREDACTED%5D&page=2");
  });
});

describe("anonymize", () => {
  it("returns a short deterministic hex digest", () => {
    const id = "org-123";
    const first = anonymize(id);
    const second = anonymize(id);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never returns the raw input", () => {
    const id = "org-123";
    expect(anonymize(id)).not.toContain(id);
  });
});
