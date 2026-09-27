import test from "node:test";
import assert from "node:assert/strict";
import { healthTransition } from "../frontend/connectivity";

test("connection stays online until three consecutive health failures", () => {
  const first = healthTransition(0, false, true);
  const second = healthTransition(first.failures, false, true);
  const third = healthTransition(second.failures, false, true);
  assert.equal(first.state, "UNCHANGED");
  assert.equal(second.state, "UNCHANGED");
  assert.equal(third.state, "OFFLINE");
});

test("one successful health probe restores connection and resets failures", () => {
  assert.deepEqual(healthTransition(3, true, true), {
    failures: 0,
    state: "ONLINE",
  });
  assert.equal(healthTransition(0, true, false).state, "OFFLINE");
});
