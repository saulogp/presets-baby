// Hardware smoke test of js/device.js against the real pedal, from Node on Linux.
// A tiny Web MIDI shim backed by ALSA raw MIDI (/dev/snd/midiCxDy).
// Usage: node tests/hw-smoke.mjs [/dev/snd/midiC2D0]
// Writes ONLY the presets it just read back (no audible change).
import fs from "node:fs";
import { CubeBaby } from "../js/device.js";

const path = process.argv[2] ?? fs.readdirSync("/dev/snd").filter((f) => f.startsWith("midiC")).map((f) => `/dev/snd/${f}`)[0];
const wfd = fs.openSync(path, "w");
const input = { name: "USB2.0 Device MIDI 1", state: "connected", onmidimessage: null };
const output = { name: "USB2.0 Device MIDI 1", state: "connected", send: (msg) => fs.writeSync(wfd, Buffer.from(msg)) };
// Non-blocking poll (a blocking read would keep Node alive at exit).
const rfd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
const rbuf = Buffer.alloc(256);
const poll = setInterval(() => {
  try {
    const n = fs.readSync(rfd, rbuf, 0, rbuf.length, null);
    if (n > 0) input.onmidimessage?.({ data: Uint8Array.from(rbuf.subarray(0, n)) });
  } catch (err) {
    if (err.code !== "EAGAIN") throw err;
  }
}, 2);

Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  requestMIDIAccess: async () => ({
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
    onstatechange: null,
  }),
} });

const dev = new CubeBaby();
dev.addEventListener("connected", (e) => console.log("connected:", e.detail));
await dev.init();
if (!dev.connected) throw new Error("pedal not found");

const presets = await dev.readPresets();
presets.forEach((p, i) => console.log(`preset ${"ABC"[i]}:`, p.map((b) => b.toString(16).padStart(2, "0")).join(" ")));

const t0 = performance.now();
await dev.loadBank(presets); // same bytes back: no change
console.log(`loadBank (3 presets) took ${(performance.now() - t0).toFixed(1)} ms`);

const after = await dev.readPresets();
console.log("unchanged after loadBank:", JSON.stringify(after) === JSON.stringify(presets));

let refused = false;
try {
  const P = await import("../js/protocol.js");
  P.liveWrite(0x05, 0x0000, [0]); // non-live write: must throw
} catch {
  refused = true;
}
console.log("safety lock refuses flash write:", refused);

clearInterval(poll);
fs.closeSync(rfd);
fs.closeSync(wfd);
