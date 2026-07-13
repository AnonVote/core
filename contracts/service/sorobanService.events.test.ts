import { describe, expect, it } from "vitest";

import {
  type SorobanConfig,
  sorobanFilterEvents,
} from "./sorobanService";

function makeConfig(events: unknown[], calls: unknown[] = []): SorobanConfig {
  return {
    stellarSecretKey: "",
    stellarNetwork: "testnet",
    contractId: "C_ANONVOTE_CONTRACT",
    rpcServer: {
      async getEvents(request: unknown) {
        calls.push(request);
        return { events, latestLedger: 1000 };
      },
    } as any,
  };
}

describe("sorobanFilterEvents", () => {
  it("filters audit events by normalized event type", async () => {
    const calls: unknown[] = [];
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
    ], calls);

    const events = await sorobanFilterEvents(config, { eventType: "token_issued" });

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("token_issued");
    expect(events[0]!.ballotIdHash).toBe("ballot-a");
    expect(events[0]!.count).toBe(1);
    expect(calls.length).toBe(1);
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
