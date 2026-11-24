// Run: node --test app/tests/
import test from "node:test";
import assert from "node:assert/strict";
import * as p from "../js/protocol.js";

const hex = (s) => s.match(/../g).map((h) => parseInt(h, 16));

test("pack identify (cuvave-midi vector)", () => {
  const clear = [0x00, 0x59, 0x11, 0x00, 0x00, 0x00, 0xff];
  assert.deepEqual(p.buildFrame(p.CMD.IDENTIFY), clear);
  assert.deepEqual(p.pack7(clear), [0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0x00]);
});

test("identify matches bytes sent to the real pedal", () => {
  assert.deepEqual(p.identify(), hex("f0003245000000407f00f7"));
});

test("preset B delay write vector", () => {
  const msg = hex("f000320949000040021b00000018000000013a01f7");
  const f = p.parseSysex(msg);
  assert.equal(f.cmd, p.CMD.WRITE);
  assert.ok(f.checksumOk);
  assert.deepEqual(p.liveParam(1, 0x0b, 1), msg);
});

test("live volume write matches the one validated on the pedal", () => {
  assert.deepEqual(p.liveParam(0, 0x05, 0x10), hex("f00032094900004002050000001800000010480 1f7".replace(" ", "")));
});

test("whole preset write matches the one validated on the pedal", () => {
  const b = hex("010100000910160507010101" + "01000000");
  assert.deepEqual(
    p.livePreset(1, b),
    hex("f00032094101004002100000000802000001020000100104 0b050e040810200000000064 00f7".replace(/ /g, "")),
  );
});

test("parse real identify reply from the pedal", () => {
  const r = p.parseSysex(hex("f00032455801004029491c0d7a5465503a624a090a262c1e1020400001126004 0a152c5c401143 07f7".replace(/ /g, "")));
  assert.ok(r.checksumOk);
  assert.equal(String.fromCharCode(...r.data.slice(0, 14)), "SINCO-CubeBaby");
});

test("roundtrip", () => {
  for (let n = 0; n < 300; n += 7) {
    const d = Array.from({ length: n }, (_, i) => (i * 37) & 0xff);
    assert.deepEqual(p.unpack7(p.pack7(d)).slice(0, n), d);
  }
});

test("safety lock refuses anything outside live preset RAM", () => {
  for (const [s, a] of [[5, 0], [0, 0x69000], [0, p.LIVE_BIT], [4, p.LIVE_BIT], [5, 0x7fffffff]]) {
    assert.throws(() => p.liveWrite(s, a, [0]), p.UnsafeOperation);
  }
  assert.throws(() => p.liveWrite(5, p.LIVE_BIT + 0x30, [0]), p.UnsafeOperation);
  assert.throws(() => p.liveWrite(5, p.LIVE_BIT + 0x2f, [0, 0]), p.UnsafeOperation);
  assert.throws(() => p.liveParam(2, 15, 256), p.UnsafeOperation);
  assert.throws(() => p.livePreset(0, [1, 2, 3]), p.UnsafeOperation);
  assert.doesNotThrow(() => p.liveWrite(5, p.LIVE_BIT + 0x2f, [0]));
});
