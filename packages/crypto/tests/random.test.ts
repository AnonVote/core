import * as fs from "fs";
import * as path from "path";

import { getRandomBytes, bytesToHex, randomUUID } from "../src/random";

/**
 * Cross-runtime randomness.
 *
 * The environment-specific behaviour is exercised by manipulating
 * `globalThis.crypto`, which is what actually differs between Node, the edge
 * runtimes and browsers — Cloudflare Workers and Vercel Edge both expose Web
 * Crypto and no `require`, while older Node exposes `require` and no global
 * `crypto`. Simulating that here is more honest than asserting on a runtime
 * detection flag, and it runs in ordinary CI.
 */

const globalWithCrypto = globalThis as { crypto?: unknown };
const realCrypto = globalWithCrypto.crypto;

afterEach(() => {
  globalWithCrypto.crypto = realCrypto;
  jest.restoreAllMocks();
});

describe("getRandomBytes", () => {
  it("returns the requested number of bytes", () => {
    for (const size of [1, 12, 16, 32, 64]) {
      const bytes = getRandomBytes(size);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(size);
    }
  });

  it("uses Web Crypto when a global crypto is available", () => {
    // Cloudflare Workers, Vercel Edge, browsers, and Node 19+.
    const getRandomValues = jest.fn((array: Uint8Array) => {
      array.fill(7);
      return array;
    });
    globalWithCrypto.crypto = { getRandomValues };

    const bytes = getRandomBytes(4);

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(Array.from(bytes)).toEqual([7, 7, 7, 7]);
  });

  it("falls back to Node's crypto when no global crypto exists", () => {
    // Older Node, where `globalThis.crypto` is undefined.
    delete globalWithCrypto.crypto;

    const bytes = getRandomBytes(32);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(32);
    expect(Array.from(bytes).some((b) => b !== 0)).toBe(true);
  });

  it("ignores a global crypto that lacks getRandomValues", () => {
    // A partial polyfill must not be mistaken for Web Crypto.
    globalWithCrypto.crypto = { subtle: {} };

    const bytes = getRandomBytes(16);
    expect(bytes).toHaveLength(16);
  });

  it("produces different output on successive calls", () => {
    const a = bytesToHex(getRandomBytes(32));
    const b = bytesToHex(getRandomBytes(32));
    expect(a).not.toBe(b);
  });

  it("produces well-distributed bytes rather than a constant", () => {
    // A smoke test for the obvious catastrophic failures — an all-zero buffer
    // or a single repeated byte — not a statistical randomness test.
    const bytes = getRandomBytes(4096);
    const distinct = new Set(bytes).size;
    expect(distinct).toBeGreaterThan(200);
  });
});

describe("bytesToHex", () => {
  it("pads single-digit bytes to two characters", () => {
    expect(bytesToHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("returns an empty string for empty input", () => {
    expect(bytesToHex(new Uint8Array(0))).toBe("");
  });

  it("does not depend on Buffer", () => {
    // Buffer is absent in edge runtimes; this must still work without it.
    const savedBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    delete (globalThis as { Buffer?: unknown }).Buffer;
    try {
      expect(bytesToHex(Uint8Array.from([171, 205]))).toBe("abcd");
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = savedBuffer;
    }
  });
});

describe("randomUUID", () => {
  it("returns an RFC 4122 version 4 UUID", () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sets the version and variant bits regardless of the random source", () => {
    // Feed all-zero bytes: only the version and variant nibbles should be set.
    globalWithCrypto.crypto = {
      getRandomValues: (array: Uint8Array) => array.fill(0),
    };
    expect(randomUUID()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("returns distinct values", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomUUID()));
    expect(ids.size).toBe(500);
  });

  it("works without a global crypto", () => {
    delete globalWithCrypto.crypto;
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("edge bundle safety", () => {
  /**
   * The regression this issue is really about.
   *
   * `src/index.ts` re-exports the client, so a top-level `import ... from
   * "crypto"` anywhere in the module graph makes an edge bundler pull Node's
   * crypto into the output — and the module throws on import — no matter which
   * functions the consumer calls. Node's crypto may only be reached through a
   * `require()` inside a function body, which bundlers do not resolve eagerly.
   */
  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });

  it("has no top-level import of Node's crypto module in src/", () => {
    const offenders = sourceFiles(path.join(__dirname, "..", "src")).filter(
      (file) => {
        const source = fs.readFileSync(file, "utf8");
        // Strip block comments so JSDoc examples don't count as imports.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
        return /^\s*import\s[^;]*from\s+["'](node:)?crypto["']/m.test(code);
      },
    );
    expect(offenders).toEqual([]);
  });

  it("only reaches Node's crypto through a lazy require", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "random.ts"),
      "utf8",
    );
    expect(source).toMatch(/return require\("crypto"\)/);
  });
});

describe("edge runtime simulation", () => {
  /**
   * Loads the package's source entry point with Node's `crypto` module made
   * unresolvable, which is the situation on Cloudflare Workers and Vercel Edge.
   *
   * This is the end-to-end version of the static check above: it proves the
   * module graph can be imported and tokens generated with no Node crypto at
   * all, rather than only that no source file names it. Before this change the
   * import itself threw here.
   */
  const withoutNodeCrypto = <T>(fn: () => T): T => {
    const Module = require("module");
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request: string, ...rest: unknown[]) {
      if (request === "crypto" || request === "node:crypto") {
        throw new Error(`Cannot find module '${request}' (simulated edge)`);
      }
      return originalLoad.call(this, request, ...rest);
    };
    try {
      return fn();
    } finally {
      Module._load = originalLoad;
    }
  };

  beforeEach(() => {
    jest.resetModules();
    // Edge runtimes always provide Web Crypto.
    globalWithCrypto.crypto = realCrypto;
  });

  it("imports the public entry point with no Node crypto available", () => {
    const lib = withoutNodeCrypto(() => require("../src/index"));
    expect(typeof lib.generateToken).toBe("function");
    expect(typeof lib.AnonVoteClient).toBe("function");
  });

  it("generates valid, distinct tokens with no Node crypto available", () => {
    const { generateToken } = withoutNodeCrypto(() => require("../src/index"));
    const a = withoutNodeCrypto(() => generateToken());
    const b = withoutNodeCrypto(() => generateToken());

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("constructs the client with no Node crypto available", () => {
    const { AnonVoteClient } = withoutNodeCrypto(() => require("../src/index"));
    const client = withoutNodeCrypto(
      () => new AnonVoteClient({ apiUrl: "https://example.test", apiKey: "k" }),
    );
    expect(client).toBeDefined();
  });
});
