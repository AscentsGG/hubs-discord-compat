import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../src/index.js";

/*
 * These checks keep the metadata, the changelog, the license and the built
 * types in step, so every release ships the same shape.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("package: version, changelog and metadata agree", () => {
  assert.equal(manifest.version, version);
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.equal(/^## (\S+)/m.exec(changelog)?.[1], version);
  assert.deepEqual(manifest.exports["."], {
    types: "./dist/index.d.ts",
    default: "./dist/index.js",
  });
  assert.equal(manifest.types, "./dist/index.d.ts");
  for (const file of ["dist", "docs", "README.md", "CHANGELOG.md", "LICENSE"])
    assert.ok(manifest.files.includes(file), file);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "MIT");
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /^MIT License/);
  assert.equal(
    manifest.repository.url,
    "git+https://github.com/AscentsGG/hubs-discord-compat.git",
  );
  assert.ok(manifest.scripts.prepublishOnly.includes("test"));
  assert.ok(manifest.scripts.prepack.includes("build"));
  // No runtime dependencies to vet.
  assert.equal(manifest.dependencies, undefined);
  for (const text of [
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    join("docs", "PORTING.md"),
  ].map((file) => readFileSync(join(root, file), "utf8"))) {
    assert.ok(!text.includes(String.fromCharCode(0x2014)), "no em dashes");
    assert.ok(!/(^|[^-])--([^-]|$)/m.test(text.replace(/```[\s\S]*?```/g, "")));
  }
});

test("package: the build emits types for the public surface", () => {
  const tsc = [
    join(root, "node_modules", ".bin", "tsc"),
    join(root, "..", "..", "node_modules", ".bin", "tsc"),
  ].find((path) => existsSync(path));
  if (!tsc) return;
  const out = mkdtempSync(join(tmpdir(), "hubs-compat-build-"));
  try {
    execFileSync(tsc, ["-p", join(root, "tsconfig.json"), "--outDir", out], {
      stdio: "pipe",
    });
    const types = readFileSync(join(out, "index.d.ts"), "utf8");
    for (const name of [
      "Client",
      "SlashCommandBuilder",
      "SlashCommandSubcommandBuilder",
      "CommandInteractionOptionResolver",
      "HubsNotSupportedError",
    ])
      assert.ok(
        types.includes(name) ||
          readFileSync(join(out, "builders.d.ts"), "utf8").includes(name),
        name,
      );
    assert.match(types, /export declare const version/);
    assert.ok(existsSync(join(out, "index.js")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
