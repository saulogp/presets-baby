// Preset layout for the regular Cube Baby (chip 0x4F06): 16 bytes per preset.
//
// Offsets and maximum values come from the CubeSuite Android app
// (github.com/kaizenberg-hub/CubeSuite, mvave/Setting.kt), and agree with what we
// measured on the user's pedal (docs/calibration.md). Values above the maximum can
// leave the DSP muted until the AMP block is switched off and on again, so every
// value sent to the pedal is clamped with sanitizePreset().

// Display order follows the pedal's knobs: VOLUME, IR CAB, REVERB, MIX, FB, TIME, MOD, TONE, GAIN.
// TYPE comes last.
export const PARAMS = [
  { off: 5, key: "volume", label: "VOLUME", max: 127 },
  { off: 9, key: "ir", label: "IR CAB", max: 8 },
  { off: 3, key: "reverb", label: "REVERB", max: 15 },
  { off: 7, key: "mix", label: "MIX", max: 118 },
  { off: 4, key: "fb", label: "FB", max: 127 },
  { off: 6, key: "time", label: "TIME", max: 31 },
  // MOD is bipolar (cubecontrol / Cube Baby manual): 0-6 chorus, 7-8 off, 9-15 phaser.
  { off: 8, key: "mod", label: "MOD", max: 15, describe: (v) => (v <= 6 ? "chorus" : v <= 8 ? "desligado" : "phaser") },
  { off: 2, key: "tone", label: "TONE", max: 15 },
  { off: 1, key: "gain", label: "GAIN", max: 7 },
  { off: 0, key: "type", label: "TYPE (pré-amp)", max: 8 },
];

export const SWITCHES = [
  { off: 12, key: "ampSw", label: "AMP ligado" },
  { off: 10, key: "cabSw", label: "CAB (IR) ligado" },
  { off: 11, key: "modSw", label: "MOD / DELAY ligado" },
];

export const AMP_SW = 12;

const MAX_BY_OFFSET = (() => {
  const m = new Array(16).fill(0); // bytes 13-15 are unused: keep them 0
  for (const p of PARAMS) m[p.off] = p.max;
  for (const s of SWITCHES) m[s.off] = 1;
  return m;
})();

/** Clamp every byte to its valid range. Returns a new array. */
export function sanitizePreset(bytes) {
  return Array.from({ length: 16 }, (_, i) => {
    const v = Number.isInteger(bytes[i]) ? bytes[i] : 0;
    return Math.min(Math.max(v, 0), MAX_BY_OFFSET[i]);
  });
}

export const clampParam = (off, v) => Math.min(Math.max(v | 0, 0), MAX_BY_OFFSET[off]);

// The user's pedal presets as read on 2026-11-23, used as defaults before
// the first connection.
export const DEFAULT_PRESETS = [
  [0x01, 0x01, 0x00, 0x00, 0x0a, 0x3d, 0x16, 0x05, 0x05, 0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00],
  [0x01, 0x01, 0x00, 0x00, 0x09, 0x3e, 0x16, 0x05, 0x07, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00],
  [0x01, 0x01, 0x00, 0x00, 0x09, 0x3e, 0x16, 0x05, 0x0a, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00],
];

export const SLOT_NAMES = ["A", "B", "C"];
