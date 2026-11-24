// Cube Baby SysEx protocol — port of cubebaby/protocol.py (validated on chip 0x4F06).
//
// Clear frame:  00 59 | CMD u8 | LEN u24 LE | DATA[LEN] | CHK (= ~sum(DATA) & 0xFF)
// Wire:         F0 <clear frame packed LSB-first into 7-bit bytes> F7

export const CMD = { ACK: 0x00, IDENTIFY: 0x11, STATUS: 0x12, WRITE: 0x22, READ: 0x23 };
// Note: ERASE (0x21) is intentionally not defined. This app never erases flash.

export const LIVE_BIT = 0x80000000;
export const PRESET_SPACE = 0x05;
export const PRESET_SIZE = 16;
export const PRESET_COUNT = 3;

export class UnsafeOperation extends Error {}

export function pack7(bytes) {
  const out = [];
  let acc = 0, nbits = 0;
  for (const b of bytes) {
    acc |= b << nbits;
    nbits += 8;
    while (nbits >= 7) {
      out.push(acc & 0x7f);
      acc >>>= 7;
      nbits -= 7;
    }
  }
  out.push(acc & 0x7f); // device always emits a final byte, even with 0 leftover bits
  return out;
}

export function unpack7(bytes) {
  const out = [];
  let acc = 0, nbits = 0;
  for (const b of bytes) {
    if (b & 0x80) throw new Error(`high bit inside SysEx: ${b}`);
    acc |= b << nbits;
    nbits += 7;
    if (nbits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      nbits -= 8;
    }
  }
  return out;
}

export const checksum = (data) => ~data.reduce((s, b) => s + b, 0) & 0xff;

const u24 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

export function buildFrame(cmd, data = []) {
  return [0x00, 0x59, cmd, ...u24(data.length), ...data, checksum(data)];
}

export const toSysex = (frame) => [0xf0, ...pack7(frame), 0xf7];

export function parseSysex(msg) {
  if (msg[0] !== 0xf0 || msg[msg.length - 1] !== 0xf7) throw new Error("not SysEx");
  const clear = unpack7(msg.slice(1, -1));
  if (clear[0] !== 0x00 || clear[1] !== 0x59) throw new Error("bad magic");
  const cmd = clear[2];
  const len = clear[3] | (clear[4] << 8) | (clear[5] << 16);
  const data = clear.slice(6, 6 + len);
  if (data.length !== len || clear.length < 7 + len) throw new Error("truncated frame");
  return { cmd, data, checksumOk: clear[6 + len] === checksum(data) };
}

// ---- requests ---------------------------------------------------------------

export const identify = () => toSysex(buildFrame(CMD.IDENTIFY));
export const status = () => toSysex(buildFrame(CMD.STATUS));

export function readMem(space, addr, length) {
  return toSysex(buildFrame(CMD.READ, [space, ...u32(addr), ...u24(length)]));
}

/** Safety lock: the only write allowed is a live (RAM-only) write inside the
 *  3 x 16-byte preset area. Anything that could reach flash throws. */
export function checkWriteAllowed(space, addr) {
  if (space !== PRESET_SPACE || addr < LIVE_BIT || addr > 0xffffffff) {
    throw new UnsafeOperation(`write refused: space ${space} addr 0x${addr.toString(16)}`);
  }
  if (addr - LIVE_BIT >= PRESET_SIZE * PRESET_COUNT) {
    throw new UnsafeOperation(`live address 0x${addr.toString(16)} outside preset area`);
  }
}

export function liveWrite(space, addr, data) {
  if (!data.length) throw new UnsafeOperation("empty write");
  checkWriteAllowed(space, addr);
  checkWriteAllowed(space, addr + data.length - 1);
  for (const b of data) {
    if (!Number.isInteger(b) || b < 0 || b > 0xff) throw new UnsafeOperation(`bad byte ${b}`);
  }
  return toSysex(buildFrame(CMD.WRITE, [space, ...u32(addr), ...u24(data.length), ...data]));
}

/** Whole preset (16 bytes) into slot 0..2, RAM only. */
export function livePreset(slot, bytes) {
  if (bytes.length !== PRESET_SIZE) throw new UnsafeOperation("preset must be 16 bytes");
  return liveWrite(PRESET_SPACE, LIVE_BIT + slot * PRESET_SIZE, bytes);
}

/** Single parameter into slot 0..2, RAM only. */
export function liveParam(slot, offset, value) {
  return liveWrite(PRESET_SPACE, LIVE_BIT + slot * PRESET_SIZE + offset, [value]);
}
