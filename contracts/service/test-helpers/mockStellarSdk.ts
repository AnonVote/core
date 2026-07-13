/**
 * Hand-rolled fake of the slice of `stellar-sdk` that sorobanService.ts touches.
 *
 * We do NOT spin up a real mock RPC server class — per the issue's contributor
 * note, the whole `stellar-sdk` module is replaced via vi.mock() in each test
 * file, and this factory builds the fake module. mockRpc.* are vi.fn() handles
 * individual tests reassign to control simulateTransaction/sendTransaction/
 * getTransaction behavior per scenario.
 *
 * This does not model real Soroban XDR/auth/fees — it only reproduces the
 * call shapes sorobanService.ts depends on, so the TS-layer control flow
 * (error mapping, retries, idempotency) can be exercised without a live
 * network. Contract correctness itself is covered separately by the Rust
 * unit tests in contracts/anonvote/src/lib.rs.
 */
import { vi } from "vitest";

export const mockRpc = {
  getAccount: vi.fn(async (pubKey: string) => ({
    accountId: () => pubKey,
    sequenceNumber: () => "1",
  })),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
};

export function resetMockRpc() {
  mockRpc.getAccount.mockReset().mockImplementation(async (pubKey: string) => ({
    accountId: () => pubKey,
    sequenceNumber: () => "1",
  }));
  mockRpc.simulateTransaction.mockReset();
  mockRpc.sendTransaction.mockReset();
  mockRpc.getTransaction.mockReset();
}

/** Fake ScVal wrapper — carries a native value plus a tag so our fake
 * scValToNative/isSimulationError can recognize and unwrap it. */
export function fakeScVal(value: unknown) {
  return { __fakeScVal: true, value };
}

export function simulationSuccess(retval?: unknown) {
  if (retval === undefined) {
    return { __kind: "success", result: undefined };
  }
  return { __kind: "success", result: { retval: fakeScVal(retval) } };
}

export function simulationError(errorText: string) {
  return { __kind: "error", error: errorText };
}

export function txSuccess(returnValue?: unknown) {
  return {
    status: "SUCCESS",
    returnValue: returnValue !== undefined ? fakeScVal(returnValue) : undefined,
  };
}

export function txNotFound() {
  return { status: "NOT_FOUND" };
}

export function txFailed() {
  return { status: "FAILED" };
}

class FakeServer {
  getAccount = mockRpc.getAccount;
  simulateTransaction = mockRpc.simulateTransaction;
  sendTransaction = mockRpc.sendTransaction;
  getTransaction = mockRpc.getTransaction;
  constructor(_url: string, _opts?: unknown) {}
}

const GetTransactionStatus = {
  SUCCESS: "SUCCESS",
  NOT_FOUND: "NOT_FOUND",
  FAILED: "FAILED",
};

const Api = {
  GetTransactionStatus,
  isSimulationError(sim: any) {
    return !!sim && sim.__kind === "error";
  },
  isSimulationSuccess(sim: any) {
    return !!sim && sim.__kind === "success";
  },
};

function assembleTransaction(tx: any, _sim: any) {
  return { build: () => tx };
}

export const VALID_SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;
export const VALID_CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

class FakeKeypair {
  private _publicKey: string;
  private constructor(publicKey: string) {
    this._publicKey = publicKey;
  }
  publicKey() {
    return this._publicKey;
  }
  sign(_tx?: unknown) {
    /* no-op — signing has no observable effect in these tests */
  }
  static fromSecret(secret: string) {
    if (!VALID_SECRET_KEY_REGEX.test(secret ?? "")) {
      throw new Error("invalid secret key");
    }
    // Deterministic fake pubkey derived from the secret so the same secret
    // always maps to the same "caller" across calls within a test.
    return new FakeKeypair("GFAKE" + secret.slice(1, 11));
  }
  static random() {
    return new FakeKeypair("GFAKERANDOMPUBLICKEY");
  }
}

class FakeContract {
  constructor(public contractId: string) {}
  call(method: string, ...args: any[]) {
    return { __op: true, method, args };
  }
}

class FakeTransactionBuilder {
  private ops: any[] = [];
  constructor(_account: any, _opts: any) {}
  addOperation(op: any) {
    this.ops.push(op);
    return this;
  }
  setTimeout(_seconds: number) {
    return this;
  }
  build() {
    return { __tx: true, operations: this.ops, sign: vi.fn() };
  }
}

const StrKey = {
  isValidEd25519SecretSeed: (key: string) => VALID_SECRET_KEY_REGEX.test(key ?? ""),
  isValidContract: (id: string) => VALID_CONTRACT_ID_REGEX.test(id ?? ""),
};

export function createStellarSdkMock() {
  return {
    Keypair: FakeKeypair,
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
    },
    BASE_FEE: "100",
    Contract: FakeContract,
    TransactionBuilder: FakeTransactionBuilder,
    StrKey,
    nativeToScVal: (value: unknown, _opts: any) => fakeScVal(value),
    scValToNative: (scVal: any) => (scVal && scVal.__fakeScVal ? scVal.value : scVal),
    SorobanRpc: {
      Server: FakeServer,
      Api,
      assembleTransaction,
    },
  };
}