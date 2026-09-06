import { bytesToBase64Url } from "../src/utils";

describe("bytesToBase64Url", () => {
  it("encodes bytes to base64url without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).toBe("AAECAwQF");
    expect(encoded).not.toContain("=");
  });

  it("replaces + with - and / with _", () => {
    // Uint8Array([251, 255, 191]) -> 0xfb, 0xff, 0xbf -> "++//" in base64 -> "--__" in base64url
    const bytes = new Uint8Array([251, 255, 191]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).toBe("-_-_");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("produces a 43-character base64url string for 32 bytes", () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = i * 7;
    }
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).toHaveLength(43);
    expect(encoded).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("decodes back to the original 32 bytes using Buffer base64url", () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = (i * 13 + 37) % 256;
    }
    const encoded = bytesToBase64Url(bytes);
    // Convert back from base64url to bytes
    const decoded = new Uint8Array(Buffer.from(encoded, "base64url"));
    expect(decoded).toEqual(bytes);
  });
});
