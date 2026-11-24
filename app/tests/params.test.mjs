import test from "node:test";
import assert from "node:assert/strict";
import { PARAMS, SWITCHES, sanitizePreset, clampParam, DEFAULT_PRESETS } from "../js/params.js";

test("map matches CubeSuite Setting.kt (offset -> max)", () => {
  const byOff = Object.fromEntries([...PARAMS.map((p) => [p.off, p.max]), ...SWITCHES.map((s) => [s.off, 1])]);
  assert.deepEqual(byOff, { 0: 8, 1: 7, 2: 15, 3: 15, 4: 127, 5: 127, 6: 31, 7: 118, 8: 15, 9: 8, 10: 1, 11: 1, 12: 1 });
});

test("sanitize clamps the values that muted the pedal in our tests", () => {
  const bad = [...DEFAULT_PRESETS[1]];
  bad[2] = 60; // TONE 60 -> muted
  bad[3] = 16; // REVERB 16 -> muted
  bad[1] = 64; // GAIN out of range
  bad[13] = 9; // unused byte
  const s = sanitizePreset(bad);
  assert.equal(s[2], 15);
  assert.equal(s[3], 15);
  assert.equal(s[1], 7);
  assert.equal(s[13], 0);
  assert.equal(s[5], bad[5]); // volume untouched
});

test("the pedal's own presets are already valid", () => {
  for (const p of DEFAULT_PRESETS) assert.deepEqual(sanitizePreset(p), p);
});

test("clampParam", () => {
  assert.equal(clampParam(3, 99), 15);
  assert.equal(clampParam(5, 200), 127);
  assert.equal(clampParam(12, 5), 1);
  assert.equal(clampParam(1, -3), 0);
});
