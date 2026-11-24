# babycube: preset banks for the Cube Baby (no firmware change)

**App:** https://saulogp.github.io/presets-baby/ (Chrome on Android/desktop)

The Cube Baby (Cuvave/M-VAVE) stores only 3 presets (A/B/C). This project keeps
an unlimited library of presets on the phone and loads one **bank of 3** at a
time into the pedal's **RAM** over USB MIDI. Nothing is ever written to flash.
When the pedal is power-cycled, it goes back to its own saved presets.

## Status (validated on the user's pedal, 2026-11-23)

- Pedal: regular Cube Baby, USB `301a:5555`, identify `SINCO-CubeBaby`, chip id `0x4F06`.
- Live write (space `0x05`, address `0x80000000 + slot*16 + offset`) changes the sound
  immediately. After a power cycle the presets were byte-identical to the backup.
- Writing to an inactive slot works and survives switching A/B/C.
- A whole 16-byte preset fits in one message. A full bank (3 presets + AMP restart,
  6 messages) loads in ~340 ms.
- Full byte map and ranges: see `docs/calibration.md` (from the CubeSuite Android app,
  confirmed by our measurements). **Out-of-range values mute the pedal** until AMP_SW is
  switched off and on, so the app clamps every value and restarts AMP on each bank load.
- The pedal sends nothing over USB on footswitch or knob changes.
- Physical knobs don't touch the preset area. The volume knob's raw position is a
  float32 at space `0x04` addr `0x0f6c`.
- Space `0x00` reads return a RAM buffer, **not** flash (see `backup/README.md`).

## Layout

| Path | What |
|---|---|
| `cbtool.py`, `cubebaby/` | Python CLI (stdlib only, ALSA raw MIDI): `probe`, `info`, `presets`, `read`, `live`, `liveset` |
| `tests/test_protocol.py` | Python protocol tests (`python3 -m unittest`) |
| `app/` | PWA (Web MIDI, Chrome on Android/desktop): banks, stage view, editor, backup |
| `app/tests/protocol.test.mjs` | JS protocol tests (`cd app && npm test`) |
| `app/tests/hw-smoke.mjs` | Runs `app/js/device.js` against the real pedal from Node (writes back identical bytes) |
| `tools/make_icons.py` | Generates the PWA icons |
| `backup/` | Original presets read before any write |

## Safety rule

`protocol.py` / `protocol.js` only build writes to space `0x05` with the live bit set,
inside the 48-byte preset area. Erase (`0x21`) is not implemented. `device.js` also
refuses writes when the chip id is not a validated one (`0x4F06`).

## Run the app locally

```sh
cd app && python3 -m http.server 8779 --bind 127.0.0.1
# open http://127.0.0.1:8779 in Chrome/Chromium (Web MIDI + SysEx permission)
```

Web MIDI needs a secure context (HTTPS or localhost), so the phone needs the app
served over HTTPS.
