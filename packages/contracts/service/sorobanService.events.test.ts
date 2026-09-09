import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockRpc,
  resetMockRpc,
} from "./test-helpers/mockStellarSdk";

vi.mock("stellar-sdk", async () => {
  const { createStellarSdkMock } = await import("./test-helpers/mockStellarSdk");
  return createStellarSdkMock();
});

import * as StellarSdk from "stellar-sdk";
import {
  type SorobanConfig,
  sorobanFilterEvents,
} from "./sorobanService";

const VALID_SECRET_KEY = "S" + "B".repeat(55);

function makeConfig(events: unknown[]): SorobanConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "C_ANONVOTE_CONTRACT",
    sourceKeypair: StellarSdk.Keypair.fromSecret(VALID_SECRET_KEY),
  };
}

beforeEach(() => {
  resetMockRpc();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sorobanFilterEvents", () => {
  it("filters audit events by normalized event type", async () => {
    const config = makeConfig([
      {
        id: "1",
        ledger: 100,
        ledgerClosedAt: "2026-06-17T10:00:00Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "tok_issd"],
        value: ["ballot-a", 1],
      },
      {
        id: "2",
        ledger: 101,
        ledgerClosedAt: "2026-06-17T10:01:00Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "vote_cast"],
        value: ["ballot-a", 1],
      },
    ]);
    mockRpc.getEvents.mockResolvedValue({
      events: [
        {
          id: "1",
          ledger: 100,
          ledgerClosedAt: "2026-06-17T10:00:00Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "tok_issd" }],
          value: { __fakeScVal: true, value: ["ballot-a", 1] },
        },
        {
          id: "2",
          ledger: 101,
          ledgerClosedAt: "2026-06-17T10:01:00Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "vote_cast" }],
          value: { __fakeScVal: true, value: ["ballot-a", 1] },
        },
      ],
      latestLedger: 1000,
    });

    const events = await sorobanFilterEvents(config, { eventType: "token_issued" });

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("token_issued");
    expect(events[0]!.ballotIdHash).toBe("ballot-a");
    expect(events[0]!.count).toBe(1);
    expect(mockRpc.getEvents).toHaveBeenCalledTimes(1);
  });

  it("filters audit events by ballot ID and ledger close time range", async () => {
    const config = makeConfig([
      {
        id: "1",
        ledger: 100,
        ledgerClosedAt: "2026-06-17T09:59:59Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "tok_issd"],
        value: ["ballot-a", 1],
      },
      {
        id: "2",
        ledger: 101,
        ledgerClosedAt: "2026-06-17T10:00:00Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "tok_issd"],
        value: ["ballot-b", 1],
      },
      {
        id: "3",
        ledger: 102,
        ledgerClosedAt: "2026-06-17T10:01:00Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "tok_issd"],
        value: ["ballot-a", 2],
      },
      {
        id: "4",
        ledger: 103,
        ledgerClosedAt: "2026-06-17T10:02:01Z",
        contractId: "C_ANONVOTE_CONTRACT",
        topics: ["audit", "tok_issd"],
        value: ["ballot-a", 3],
      },
    ]);
    mockRpc.getEvents.mockResolvedValue({
      events: [
        {
          id: "1",
          ledger: 100,
          ledgerClosedAt: "2026-06-17T09:59:59Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "tok_issd" }],
          value: { __fakeScVal: true, value: ["ballot-a", 1] },
        },
        {
          id: "2",
          ledger: 101,
          ledgerClosedAt: "2026-06-17T10:00:00Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "tok_issd" }],
          value: { __fakeScVal: true, value: ["ballot-b", 1] },
        },
        {
          id: "3",
          ledger: 102,
          ledgerClosedAt: "2026-06-17T10:01:00Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "tok_issd" }],
          value: { __fakeScVal: true, value: ["ballot-a", 2] },
        },
        {
          id: "4",
          ledger: 103,
          ledgerClosedAt: "2026-06-17T10:02:01Z",
          contractId: "C_ANONVOTE_CONTRACT",
          topics: [{ __fakeScVal: true, value: "audit" }, { __fakeScVal: true, value: "tok_issd" }],
          value: { __fakeScVal: true, value: ["ballot-a", 3] },
        },
      ],
      latestLedger: 1000,
    });

    const events = await sorobanFilterEvents(config, {
      ballotIdHash: "ballot-a",
      startTime: Date.parse("2026-06-17T10:00:00Z"),
      endTime: Date.parse("2026-06-17T10:02:00Z") / 1000,
    });

    expect(events.map((event) => event.id)).toEqual(["3"]);
    expect(events[0]!.eventType).toBe("token_issued");
    expect(events[0]!.count).toBe(2);
  });
});
