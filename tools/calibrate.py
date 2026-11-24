#!/usr/bin/env python3
"""Calibrate preset bytes by measuring the pedal's own USB audio (stdlib only).

While the user plays a repeated note, each preset byte of the active slot is set to
a LOW value, then to a HIGH value (RAM only), then restored. The pedal's USB capture is
recorded, and audio features are compared between LOW and HIGH:
  level   RMS in dBFS (volume / IR level)
  bright  spectral centroid in Hz (tone / IR / gain)
  zcr     zero-crossing rate (brightness / distortion)
  floor   level of the quietest 20% of 50 ms frames minus the loudest 20%
          (gaps between notes get filled by reverb / delay)

Usage: python3 tools/calibrate.py SLOT [--source NAME] [--out DIR]
"""

import argparse
import array
import cmath
import json
import math
import os
import subprocess
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cubebaby import protocol as p  # noqa: E402
from cubebaby.transport import RawMidi  # noqa: E402

SOURCE = "alsa_input.usb-SmartlinkTechnology_USB2.0_Device_USB-Audio-00.mono-fallback"
RATE = 48000

# (offset, low, high, guess)
PLAN = [
    (0x00, 0, 4, "IR CAB (confirmed)"),
    (0x01, 0, 60, "GAIN (confirmed)"),
    (0x02, 0, 60, "TONE?"),
    (0x03, 0, 60, "REVERB?"),
    (0x04, 0, 60, "FB?"),
    (0x06, 0, 60, "TIME?"),
    (0x07, 0, 60, "MIX?"),
    (0x08, 0, 10, "MOD?"),
    (0x09, 0, 6, "TYPE?"),
    (0x0A, 0, 1, "IR on?"),
    (0x0B, 0, 1, "DELAY on?"),
    (0x0C, 0, 1, "AMP/TONE on?"),
]
SEG = 4.0  # seconds per LOW / HIGH segment
GAP = 2.0  # seconds after restore


def fft(x):
    n = len(x)
    if n == 1:
        return x
    even, odd = fft(x[0::2]), fft(x[1::2])
    out = [0] * n
    for k in range(n // 2):
        t = cmath.exp(-2j * math.pi * k / n) * odd[k]
        out[k], out[k + n // 2] = even[k] + t, even[k] - t
    return out


def features(s):
    if not s:
        return None
    rms = math.sqrt(sum(v * v for v in s) / len(s))
    zcr = sum(1 for a, b in zip(s, s[1:]) if (a < 0) != (b < 0)) / (len(s) / RATE)
    frame = RATE // 20
    lv = sorted(math.sqrt(sum(v * v for v in s[i:i + frame]) / frame) + 1e-9
                for i in range(0, len(s) - frame, frame))
    k = max(1, len(lv) // 5)
    floor = 20 * math.log10((sum(lv[:k]) / k) / (sum(lv[-k:]) / k))
    # spectral centroid over a few 2048-sample windows taken from the loudest parts
    n = 2048
    wins = sorted(range(0, len(s) - n, n), key=lambda i: -sum(abs(v) for v in s[i:i + n:16]))[:6]
    num = den = 0.0
    for i in wins:
        hann = [s[i + j] * (0.5 - 0.5 * math.cos(2 * math.pi * j / n)) for j in range(n)]
        spec = fft(hann)
        for b in range(1, n // 2):
            m = abs(spec[b])
            num += m * b * RATE / n
            den += m
    return {
        "level": 20 * math.log10(max(rms, 1e-9) / 32768),
        "bright": num / den if den else 0.0,
        "zcr": zcr,
        "floor": floor,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slot", choices=list("ABCabc"))
    ap.add_argument("--source", default=SOURCE)
    ap.add_argument("--out", default="docs/captures")
    a = ap.parse_args()
    slot = "ABC".index(a.slot.upper())
    os.makedirs(a.out, exist_ok=True)
    wav_path = os.path.join(a.out, "calibration.wav")

    with RawMidi() as dev:
        original = dev.read(p.PRESET_SPACE, slot * 16, 16)
        print("original:", original.hex(" "), flush=True)
        rec = subprocess.Popen(["pw-record", "--target", a.source, "--rate", str(RATE), "--channels", "1",
                                "--format", "s16", wav_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.monotonic()
        marks = []

        def put(off, val):
            dev.request(p.live_write(p.PRESET_SPACE, p.LIVE_BIT + slot * 16 + off, bytes([val])))

        try:
            time.sleep(3)
            for off, lo, hi, guess in PLAN:
                print(f"byte {off:#04x} ({guess}): {lo} then {hi}", flush=True)
                put(off, lo)
                s = time.monotonic() - t0
                time.sleep(SEG)
                put(off, hi)
                m = time.monotonic() - t0
                time.sleep(SEG)
                e = time.monotonic() - t0
                put(off, original[off])
                marks.append({"off": off, "guess": guess, "lo": lo, "hi": hi, "lo_t": [s, m], "hi_t": [m, e]})
                time.sleep(GAP)
        finally:
            for off in range(16):
                put(off, original[off])
            rec.terminate()
            rec.wait()
            print("restored:", dev.read(p.PRESET_SPACE, slot * 16, 16).hex(" "), flush=True)

    w = wave.open(wav_path)
    pcm = array.array("h", w.readframes(w.getnframes()))
    trim = 0.4  # skip the transition right after each change
    rows = []
    print(f"\n{'byte':6} {'guess':20} {'Δlevel dB':>9} {'Δbright Hz':>10} {'Δzcr':>7} {'Δfloor dB':>9}")
    for mk in marks:
        f = {}
        for k in ("lo", "hi"):
            t1, t2 = mk[f"{k}_t"]
            f[k] = features(pcm[int((t1 + trim) * RATE): int(t2 * RATE)])
        if not f["lo"] or not f["hi"]:
            continue
        d = {x: f["hi"][x] - f["lo"][x] for x in f["lo"]}
        rows.append({**mk, "lo_f": f["lo"], "hi_f": f["hi"], "delta": d})
        print(f"{mk['off']:#06x} {mk['guess']:20} {d['level']:9.1f} {d['bright']:10.0f} {d['zcr']:7.0f} {d['floor']:9.1f}")
    json.dump(rows, open(os.path.join(a.out, "calibration.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
