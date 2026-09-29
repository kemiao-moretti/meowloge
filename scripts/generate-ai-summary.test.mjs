import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipSummary } from "./generate-ai-summary.mjs";

test("force mode still honors explicit ai_summary false opt-outs", () => {
  assert.equal(shouldSkipSummary("false", true), true);
  assert.equal(shouldSkipSummary("existing summary", true), false);
  assert.equal(shouldSkipSummary("", true), false);
  assert.equal(shouldSkipSummary("existing summary", false), true);
});
