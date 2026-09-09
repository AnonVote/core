import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { execFileSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");

const PRIMITIVE_FILES = ["src/crypto.ts", "src/retry.ts"];

interface DocumentedFunction {
  name: string;
  params: string[];
  hasReturnType: boolean;
  jsDoc: string;
}

function getExportedFunctions(relativePath: string): DocumentedFunction[] {
  const fullPath = path.join(ROOT, relativePath);
  const sourceText = fs.readFileSync(fullPath, "utf8");
  const sourceFile = ts.createSourceFile(
    fullPath,
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );

  const results: DocumentedFunction[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const jsDocText = ts
        .getJSDocCommentsAndTags(node)
        .map((d) => d.getFullText(sourceFile))
        .join("\n");

      results.push({
        name: node.name.text,
        params: node.parameters.map((p) => p.name.getText(sourceFile)),
        hasReturnType:
          node.type !== undefined && node.type.getText(sourceFile) !== "void",
        jsDoc: jsDocText,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

describe("JSDoc completeness for crypto and retry primitives", () => {
  const functionsByFile = PRIMITIVE_FILES.map((file) => ({
    file,
    functions: getExportedFunctions(file),
  }));

  it("finds exported functions to check", () => {
    const total = functionsByFile.reduce(
      (sum, { functions }) => sum + functions.length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  for (const { file, functions } of functionsByFile) {
    for (const fn of functions) {
      describe(`${file} — ${fn.name}`, () => {
        it("has a JSDoc comment", () => {
          expect(fn.jsDoc.length).toBeGreaterThan(0);
        });

        for (const param of fn.params) {
          it(`documents @param ${param}`, () => {
            expect(fn.jsDoc).toMatch(
              new RegExp(`@param\\s+${param}\\b`),
            );
          });
        }

        if (fn.hasReturnType) {
          it("documents @returns", () => {
            expect(fn.jsDoc).toMatch(/@returns/);
          });
        }

        it("includes an @example", () => {
          expect(fn.jsDoc).toMatch(/@example/);
        });
      });
    }
  }
});

describe("TypeDoc generation", () => {
  it("runs `npm run docs` with no errors or warnings", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "typedoc-test-"));
    const typedocScript = path.join(
      ROOT,
      "node_modules",
      "typedoc",
      "bin",
      "typedoc",
    );

    try {
      const output = execFileSync(
        process.execPath,
        [
          typedocScript,
          "--options",
          path.join(ROOT, "typedoc.json"),
          "--out",
          outDir,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );

      expect(output).not.toMatch(/\[error\]/i);
      expect(output).not.toMatch(/\[warning\]/i);
      expect(fs.existsSync(path.join(outDir, "index.html"))).toBe(true);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
