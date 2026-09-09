/**
 * tests/integration/happy-path.test.ts
 *
 * Scenarios 1-3 — the complete vote lifecycle through the mocked network.
 * All [real]: every assertion is about library behaviour, not the simulator.
 */

import {
  setupFixture,
  teardownFixture,
  type IntegrationFixture,
} from "./setupFixture";
import { VoteLifecycleSimulator } from "./voteLifecycleSimulator";
import { decryptVote } from "../../src/crypto";
import { generateMerkleProof, verifyMerkleProof } from "../../src/zkp/merkle";

describe("integration: happy path", () => {
  let fixture: IntegrationFixture;
  let sim: VoteLifecycleSimulator;

  beforeEach(() => {
    fixture = setupFixture();
    sim = new VoteLifecycleSimulator(fixture);
  });

  afterEach(() => {
    teardownFixture(fixture);
  });

  // Scenario 1 [real]
  it("runs create -> issue -> vote -> tally -> verify end to end", async () => {
    const ballot = await sim.createBallot({
      options: ["Approve", "Reject", "Abstain"],
    });
    const tokens = await sim.issueTokens(5);
    expect(tokens).toHaveLength(5);

    // 3x Approve, 1x Reject, 1x Abstain
    const receipts = await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 0 },
      { tokenIndex: 2, optionIndex: 0 },
      { tokenIndex: 3, optionIndex: 1 },
      { tokenIndex: 4, optionIndex: 2 },
    ]);
    expect(receipts).toHaveLength(5);
    for (const receipt of receipts) {
      expect(receipt.ballotId).toBe(ballot.id);
      expect(receipt.voteId).toEqual(expect.any(String));
    }

    // The ciphertext the server received is not the plaintext option ID.
    const stored = fixture.backend.getStoredVotes(ballot.id);
    const approveId = ballot.options[0].id;
    expect(stored[0].encryptedPayload.ciphertext).not.toBe(approveId);
    expect(stored[0].encryptedPayload.ciphertext).toMatch(/^[0-9a-f]+$/);
    // ...but it round-trips back to it under the ballot key.
    expect(decryptVote(stored[0].encryptedPayload, fixture.ballotKey)).toBe(
      approveId,
    );

    // The ledger holds one record per vote, each with its own tx.
    const ledgerVotes = fixture.ledger.getVotes(ballot.id);
    expect(ledgerVotes).toHaveLength(5);
    expect(new Set(ledgerVotes.map((v) => v.txId)).size).toBe(5);

    // Each anchored vote reads back by transaction ID, carrying the token
    // *hash* — never the raw token — and the opaque payload.
    const readBack = await fixture.ledger.readTransaction(ledgerVotes[0].txId);
    expect(readBack).toMatchObject({
      txId: ledgerVotes[0].txId,
      ballotId: ballot.id,
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(readBack)).not.toContain(tokens[0]);
    await expect(fixture.ledger.readTransaction("tx_does_not_exist")).resolves.
      toBeNull();

    // Server-side bookkeeping tracks the same numbers the ledger does.
    const serverBallot = fixture.backend.getStoredBallot(ballot.id);
    expect(serverBallot.votesCast).toBe(5);
    expect(serverBallot.tokensIssued).toBe(5);
    expect(serverBallot.eligibleVoters).toBe(5);

    const results = await sim.tallyVotes();
    expect(results.totalVotes).toBe(5);
    expect(sim.countsByLabel(results)).toEqual({
      Approve: 3,
      Reject: 1,
      Abstain: 1,
    });

    const report = await sim.verifyResult();
    expect(report.isConsistent).toBe(true);
    expect(report.totalVotes).toBe(5);
    expect(report.stellarTxId).toEqual(expect.any(String));
  });

  // Scenario 2 [real] — privacy invariant on the wire format.
  it("never puts the plaintext option on the wire", async () => {
    const ballot = await sim.createBallot({ options: ["Yes", "No"] });
    await sim.issueTokens(1);
    await sim.castVotes([{ tokenIndex: 0, optionIndex: 0 }]);

    const voteCalls = fixture.fetchMock.callsTo("/votes");
    expect(voteCalls).toHaveLength(1);

    const body = voteCalls[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["encryptedPayload", "token"]);

    // Neither the option UUID nor its label appears anywhere in the request.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ballot.options[0].id);
    expect(serialized).not.toContain("Yes");

    const payload = body.encryptedPayload as Record<string, string>;
    expect(Object.keys(payload).sort()).toEqual(["authTag", "ciphertext", "iv"]);
  });

  // Scenario 3 [real] — inclusion proof against the anchored root.
  it("anchors a Merkle root a voter can prove inclusion against", async () => {
    const ballot = await sim.createBallot({ options: ["A", "B"] });
    await sim.issueTokens(4);
    await sim.castVotes([
      { tokenIndex: 0, optionIndex: 0 },
      { tokenIndex: 1, optionIndex: 1 },
      { tokenIndex: 2, optionIndex: 0 },
      { tokenIndex: 3, optionIndex: 1 },
    ]);

    await sim.tallyVotes();

    const anchored = fixture.ledger.getTally(ballot.id);
    expect(anchored).toBeDefined();
    expect(anchored?.merkleRoot).toBe(sim.getMerkleRoot());
    expect(anchored?.merkleRoot).toHaveLength(64);

    const leaves = sim.getMerkleLeaves();
    expect(leaves).toHaveLength(4);

    // Every voter can prove their own ballot is in the anchored tree.
    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(leaves, i);
      expect(proof.root).toBe(anchored?.merkleRoot);
      expect(verifyMerkleProof(proof)).toBe(true);
    }

    // A forged leaf does not verify against the anchored root.
    const forged = generateMerkleProof(leaves, 0);
    forged.leaf = "f".repeat(64);
    expect(verifyMerkleProof(forged)).toBe(false);
  });
});
