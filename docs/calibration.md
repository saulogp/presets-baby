# Preset byte map (regular Cube Baby, chip 0x4F06)

## Final map

Source: the CubeSuite Android app ([kaizenberg-hub/CubeSuite](https://github.com/kaizenberg-hub/CubeSuite),
`mvave/Setting.kt`, forked from wkonda/CubeSuite). It agrees with our measurements below.
The cuvave-midi `Parameter` enum had wrong labels (0 and 9 swapped, among others) and no ranges.

| Offset | Parameter | Max | Our evidence |
|---|---|---|---|
| 0 | TYPE (preamp) | 8 | Stepwise, timbre and level change (we first guessed IR CAB) |
| 1 | GAIN | 7 | By ear "dirtier"; brightness rises up to about 6-12; erratic above 7 |
| 2 | TONE | 15 | Values >= 24 mute the pedal (about -55 dBFS) |
| 3 | REVERB | 15 | Values >= 16 mute the pedal |
| 4 | FB | 127 | No mute at any value |
| 5 | VOLUME | 127 | By ear |
| 6 | TIME | 31 | No mute up to 127 |
| 7 | MIX | 118 | Not measured |
| 8 | MOD | 15 | Not measured |
| 9 | IR (cab) | 8 | Not measured |
| 10 | CAB_SW | 1 | Not measured |
| 11 | MOD_SW (mod/delay) | 1 | Not measured |
| 12 | AMP_SW | 1 | Switching it 0 -> 1 un-mutes a stuck DSP |
| 13-15 | unused | 0 | |

## Mute behavior

An out-of-range value (for example TONE=60 or REVERB>=16) mutes the output (digital zero).
Restoring the value, or rewriting the whole preset, does **not** recover it. Switching
AMP_SW off and on again does (`tools/mute_probe.py B recovery`). The app therefore:
1. clamps every value to the ranges above (`sanitizePreset`);
2. sends each preset with AMP_SW=0 and then sets AMP_SW=1 (a free AMP restart on every bank load);
3. has a "Destravar som" button.

## Method notes

- `tools/calibrate.py` and `tools/mute_probe.py` sweep bytes in RAM while recording the pedal's
  USB capture (needs `Line Capture Volume` > 0 in `amixer -c <card>`, which is 0 by default),
  with the user playing the whole time. When nobody plays, the pedal's gate outputs digital
  zero, so mute detection needs constant playing.
- Physical knobs don't show up in readable memory, except VOLUME (float32 at space 4 0x0f6c).
  The region space 4 0x18f0-0x2000 is a live audio buffer.
- Spaces 1-3 and 6-10 just echo a stale buffer. Space 4 above 0x2000 reads as zeros.
- Recordings and results are in `docs/captures/`.
