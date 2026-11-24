// Web MIDI connection to the Cube Baby. Only read and live (RAM) writes.
import * as P from "./protocol.js";
import { sanitizePreset, clampParam, AMP_SW } from "./params.js";

const SUPPORTED_CHIPS = new Set([0x4f06]); // validated: regular Cube Baby
const PORT_HINT = /usb2\.0 device|cube|sinco/i;

export class CubeBaby extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.input = null;
    this.output = null;
    this.info = null; // {name, chipId}
    this.busy = Promise.resolve();
    this.pending = null;
    this.buf = [];
  }

  get connected() {
    return !!this.info;
  }

  get supported() {
    return "requestMIDIAccess" in navigator;
  }

  async init() {
    if (!this.supported) throw new Error("Este navegador não tem Web MIDI. Use o Chrome.");
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => this._scan();
    await this._scan();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async _scan() {
    // Port events arrive in bursts (input and output separately); coalesce them.
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    this.scanning = true;
    try {
      do {
        this.rescan = false;
        await this._scanOnce();
      } while (this.rescan);
    } finally {
      this.scanning = false;
    }
  }

  async _scanOnce() {
    {
      const alive = this.output && this.output.state === "connected" && this.input?.state === "connected";
      if (alive && this.info) return;
      if (this.info) this._drop();

      const outs = [...this.access.outputs.values()].filter((p) => p.state === "connected");
      const ins = [...this.access.inputs.values()].filter((p) => p.state === "connected");
      // Try likely-named pairs first, then everything else.
      const rank = (p) => (PORT_HINT.test(p.name) ? 0 : 1);
      outs.sort((a, b) => rank(a) - rank(b));
      ins.sort((a, b) => rank(a) - rank(b));
      for (const out of outs) {
        for (const inp of ins) {
          if (await this._tryPair(inp, out)) return;
        }
      }
    }
  }

  _drop() {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.output = this.info = null;
    this._emit("disconnected");
  }

  async _tryPair(inp, out) {
    this.input = inp;
    this.output = out;
    inp.onmidimessage = (e) => this._onMessage(e.data);
    try {
      const id = await this.request(P.identify(), 800);
      const name = String.fromCharCode(...id.data.slice(0, 14));
      if (id.cmd !== P.CMD.IDENTIFY || !name.startsWith("SINCO-CubeBaby")) throw new Error("not a Cube Baby");
      const infoBytes = await this.read(0x00, 0x2100, 20);
      const chipId = infoBytes[4] | (infoBytes[5] << 8);
      this.info = { name, chipId, supported: SUPPORTED_CHIPS.has(chipId), port: out.name };
      this._emit("connected", this.info);
      return true;
    } catch {
      inp.onmidimessage = null;
      this.input = this.output = null;
      return false;
    }
  }

  _onMessage(data) {
    for (const b of data) {
      if (b >= 0xf8) continue; // realtime bytes
      if (b === 0xf0) this.buf = [];
      this.buf.push(b);
      if (b === 0xf7) {
        const msg = this.buf;
        this.buf = [];
        if (this.pending && msg[0] === 0xf0) {
          const { resolve, reject, timer } = this.pending;
          this.pending = null;
          clearTimeout(timer);
          try {
            resolve(P.parseSysex(msg));
          } catch (err) {
            reject(err);
          }
        }
      }
    }
  }

  /** Send one request and wait for its reply. Requests are serialized. */
  request(msg, timeout = 1500) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (!this.output) return reject(new Error("pedal desconectado"));
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new Error("o pedal não respondeu"));
        }, timeout);
        this.pending = { resolve, reject, timer };
        this.output.send(msg);
      });
    const p = this.busy.then(run, run);
    this.busy = p.catch(() => {});
    return p;
  }

  async read(space, addr, length) {
    const out = [];
    while (out.length < length) {
      const n = Math.min(48, length - out.length);
      const f = await this.request(P.readMem(space, addr + out.length, n));
      if (f.cmd !== P.CMD.READ || !f.checksumOk) throw new Error("resposta de leitura inválida");
      const payload = f.data.slice(8);
      if (payload.length !== n) throw new Error("leitura incompleta");
      out.push(...payload);
    }
    return out;
  }

  _requireWritable() {
    if (!this.info) throw new Error("pedal desconectado");
    if (!this.info.supported) {
      throw new Error(`chip 0x${this.info.chipId.toString(16)} não validado: escrita bloqueada`);
    }
  }

  async _write(msg) {
    this._requireWritable();
    const f = await this.request(msg);
    if (f.cmd !== P.CMD.ACK || f.data[0] !== 0) throw new Error("o pedal recusou a escrita");
  }

  /** Current RAM working copy of the 3 presets (equals the saved ones right after power-on). */
  async readPresets() {
    const raw = await this.read(P.PRESET_SPACE, 0, P.PRESET_SIZE * P.PRESET_COUNT);
    return [0, 1, 2].map((i) => raw.slice(i * 16, i * 16 + 16));
  }

  /** Load a bank (3 presets) into RAM. Nothing is saved to the pedal's flash.
   *  Values are clamped to their valid ranges, and the AMP block is restarted so the
   *  pedal can never stay muted from an earlier invalid value. */
  async loadBank(presets) {
    const safe = presets.map(sanitizePreset);
    for (let slot = 0; slot < 3; slot++) {
      const ampOn = safe[slot][AMP_SW] === 1;
      // Send with AMP off, then switch AMP on: same result, and the AMP restart is free.
      const first = ampOn ? safe[slot].map((b, i) => (i === AMP_SW ? 0 : b)) : safe[slot];
      await this._write(P.livePreset(slot, first));
      if (ampOn) await this._write(P.liveParam(slot, AMP_SW, 1));
    }
  }

  /** Switch AMP off and on again on every slot that has it on. Clears a muted DSP. */
  async unstick(presets) {
    for (let slot = 0; slot < 3; slot++) {
      if (presets[slot][AMP_SW] !== 1) continue;
      await this._write(P.liveParam(slot, AMP_SW, 0));
      await this._write(P.liveParam(slot, AMP_SW, 1));
    }
  }

  async setParam(slot, offset, value) {
    await this._write(P.liveParam(slot, offset, clampParam(offset, value)));
  }
}
