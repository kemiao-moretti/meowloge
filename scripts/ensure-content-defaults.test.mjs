import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  ensureChangelogBuild,
  hasCanonicalBuild,
} from "./ensure-content-defaults.mjs";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), "utf8");
const bodyOf = (source) => source.slice(source.indexOf("---", 4) + 3);

test("adds the canonical build block when it is missing", () => {
  const source = readFixture("changelog-missing-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /build:\n  render: never\n  list: local/);
  assert.equal(bodyOf(result), bodyOf(source));
  assert.equal(hasCanonicalBuild(source), false);
});

test("does not rewrite a changelog that already has canonical build metadata", () => {
  const source = readFixture("changelog-correct-build.md");
  assert.equal(ensureChangelogBuild(source), source);
  assert.equal(hasCanonicalBuild(source), true);
});

test("replaces a non-canonical build block without changing the body", () => {
  const source = readFixture("changelog-wrong-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /build:\n  render: never\n  list: local/);
  assert.doesNotMatch(result, /render: always/);
  assert.equal(bodyOf(result), bodyOf(source));
  assert.equal(hasCanonicalBuild(source), false);
});

test("preserves unrelated front matter and is idempotent", () => {
  const source = readFixture("changelog-missing-build.md");
  const result = ensureChangelogBuild(source);
  assert.match(result, /title: Missing build/);
  assert.match(result, /type: feature/);
  assert.match(result, /version: v9\\.9\\.1/);
  assert.match(result, /date: 2026-09-28T23:45:00\\+08:00/);
  assert.match(result, /description: fixture/);
  assert.equal(ensureChangelogBuild(result), result);
});

test("ignores files without YAML front matter", () => {
  const source = readFixture("changelog-no-frontmatter.md");
  assert.equal(ensureChangelogBuild(source), source);
});
