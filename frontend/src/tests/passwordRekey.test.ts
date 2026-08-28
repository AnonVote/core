/**
 * Password-change re-keying — Issue #86.
 *
 * The server refuses a password change that would orphan encrypted
 * descriptions. These tests pin the browser half that satisfies that check,
 * and the refusal to silently drop anything it cannot decrypt.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as apiClient from "../api/client";
import {
  buildPasswordChangePayload,
  DescriptionRekeyError,
} from "../utils/org-enrollment";
import {
  deriveOrgKeypair,
  encryptDescription,
  decryptDescription,
  toBase64,
} from "../utils/org-crypto";

const SALT = toBase64(new Uint8Array(16).fill(5));
const OLD_PASSWORD = "old password value";
const NEW_PASSWORD = "new password value";
const ORG_ID = "11111111-2222-4333-8444-555566667777";

const oldKeys = deriveOrgKeypair(OLD_PASSWORD, SALT);
const newKeys = deriveOrgKeypair(NEW_PASSWORD, SALT);

function mockOrg() {
  vi.spyOn(apiClient, "getMe").mockResolvedValue({
    data: { data: { id: ORG_ID } },
  } as any);
  vi.spyOn(apiClient, "getOrgPublicKey").mockResolvedValue({
    data: {
      data: {
        organizationId: ORG_ID,
        publicKey: oldKeys.publicKeyBase64,
        keyDerivationSalt: SALT,
        keyVersion: 1,
        algorithm: "X25519",
      },
    },
  } as any);
}

function mockBallots(
  ballots: { id: string; topic: string; descriptionCiphertext: string | null }[],
) {
  vi.spyOn(apiClient, "getBallots").mockResolvedValue({
    data: { data: ballots },
  } as any);
}

afterEach(() => vi.restoreAllMocks());

describe("buildPasswordChangePayload", () => {
  it("re-encrypts every description to the new key, preserving plaintext", async () => {
    mockOrg();
    mockBallots([
      {
        id: "b1",
        topic: "Budget",
        descriptionCiphertext: encryptDescription("First secret", oldKeys.publicKey),
      },
      {
        id: "b2",
        topic: "Policy",
        descriptionCiphertext: encryptDescription("Second secret", oldKeys.publicKey),
      },
    ]);

    const payload = await buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD);

    expect(payload.publicKey).toBe(newKeys.publicKeyBase64);
    expect(payload.reencrypted).toHaveLength(2);

    // The new ciphertexts must decrypt with the NEW key to the same plaintext.
    const byId = Object.fromEntries(
      payload.reencrypted.map((r) => [r.ballotId, r.descriptionCiphertext]),
    );
    expect(decryptDescription(byId["b1"], newKeys.privateKey)).toBe("First secret");
    expect(decryptDescription(byId["b2"], newKeys.privateKey)).toBe("Second secret");

    // And must NOT be readable with the old key any more.
    expect(() => decryptDescription(byId["b1"], oldKeys.privateKey)).toThrow();
  });

  it("covers every encrypted ballot, so the server's check passes", async () => {
    mockOrg();
    const ids = ["b1", "b2", "b3"];
    mockBallots(
      ids.map((id) => ({
        id,
        topic: id,
        descriptionCiphertext: encryptDescription(`text ${id}`, oldKeys.publicKey),
      })),
    );

    const payload = await buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD);
    expect(payload.reencrypted.map((r) => r.ballotId).sort()).toEqual(ids);
  });

  it("ignores ballots that have no description", async () => {
    mockOrg();
    mockBallots([
      { id: "b1", topic: "No description", descriptionCiphertext: null },
      {
        id: "b2",
        topic: "Has one",
        descriptionCiphertext: encryptDescription("kept", oldKeys.publicKey),
      },
    ]);

    const payload = await buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD);
    expect(payload.reencrypted).toHaveLength(1);
    expect(payload.reencrypted[0].ballotId).toBe("b2");
  });

  it("refuses rather than silently dropping an undecryptable description", async () => {
    mockOrg();
    const strangerKeys = deriveOrgKeypair("some other password", SALT);
    mockBallots([
      {
        id: "b1",
        topic: "Unreadable ballot",
        descriptionCiphertext: encryptDescription("lost", strangerKeys.publicKey),
      },
    ]);

    await expect(
      buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD),
    ).rejects.toBeInstanceOf(DescriptionRekeyError);
  });

  it("names the affected ballot so the admin knows what is at risk", async () => {
    mockOrg();
    const strangerKeys = deriveOrgKeypair("some other password", SALT);
    mockBallots([
      {
        id: "b1",
        topic: "Q3 Board Vote",
        descriptionCiphertext: encryptDescription("lost", strangerKeys.publicKey),
      },
    ]);

    await expect(
      buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD),
    ).rejects.toThrow(/Q3 Board Vote/);
  });

  it("returns an empty set when the org has no descriptions at all", async () => {
    mockOrg();
    mockBallots([{ id: "b1", topic: "Plain", descriptionCiphertext: null }]);

    const payload = await buildPasswordChangePayload(OLD_PASSWORD, NEW_PASSWORD);
    expect(payload.reencrypted).toEqual([]);
    expect(payload.publicKey).toBe(newKeys.publicKeyBase64);
  });
});
