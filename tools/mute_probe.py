#!/usr/bin/env python3
"""Step through a scripted list of RAM-only writes while recording the pedal's USB
audio, and report per step whether the output is SOUND or MUTE (digital zero).
The user must keep playing the whole time. The original preset is restored at the end.

Usage: python3 tools/mute_probe.py SLOT recovery
"""

import array
import math
import os
import subprocess
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cubebaby import protocol as p  # noqa: E402
from cubebaby.transport import RawMidi  # noqa: E402

SOURCE = "alsa_input.usb-SmartlinkTechnology_USB2.0_Device_USB-Audio-00.mono-fallback"
RATE = 48000
STEP = 3.0


def scenario_recovery(orig):
    o = list(orig)
    return [
        ("baseline (original)", [], None),
        ("byte2 = 60 (expect MUTE)", [("b", 2, 60)], None),
        ("byte2 back to original", [("b", 2, o[2])], None),
        ("rewrite whole preset (what the app does)", [("p", o)], None),
        ("byte12 0 -> 1 (worked before)", [("b", 12, 0), ("b", 12, 1)], None),
        ("rewrite whole preset again", [("p", o)], None),
    ]


SCAN_VALUES = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 127]
SWITCH_BYTES = {10, 11}


def scenario_scan(orig, offsets):
    """Each value is followed by a recovery (byte12 0->1 + restore), measured separately."""
    o = list(orig)
    steps = [("baseline", [], None)]
    for off in offsets:
        values = [0, 1] if off in SWITCH_BYTES else SCAN_VALUES
        for v in values:
            steps.append((f"byte{off}={v}", [("b", off, v)], (off, v)))
            steps.append(("  recover", [("b", off, o[off]), ("b", 12, 0), ("b", 12, 1)], None))
    return steps


def analyse(pcm, t1, t2):
    s = pcm[int((t1 + 0.4) * RATE): int(t2 * RATE)]
    if not s:
        return "n/a", float("-inf"), 0.0
    frame = RATE // 10
    frames = [s[i:i + frame] for i in range(0, len(s) - frame + 1, frame)]
    alive = sum(1 for f in frames if any(f)) / max(1, len(frames))
    rms = math.sqrt(sum(v * v for v in s) / len(s))
    db = 20 * math.log10(rms / 32768) if rms else float("-inf")
    return ("SOUND" if alive > 0.3 else "MUTE"), db, alive


def centroid(pcm, t1, t2):
    from calibrate import fft  # same folder
    s = pcm[int((t1 + 0.3) * RATE): int(t2 * RATE)]
    n = 2048
    if len(s) < n:
        return 0.0
    i = max(range(0, len(s) - n + 1, 512), key=lambda k: sum(abs(v) for v in s[k:k + n:16]))
    spec = fft([s[i + j] * (0.5 - 0.5 * math.cos(2 * math.pi * j / n)) for j in range(n)])
    mags = [abs(spec[b]) for b in range(1, n // 2)]
    den = sum(mags)
    return sum(m * (b + 1) * RATE / n for b, m in enumerate(mags)) / den if den else 0.0


def main():
    slot = "ABC".index(sys.argv[1].upper())
    mode = sys.argv[2]
    if mode == "recovery":
        scen = scenario_recovery
    else:  # scan: comma-separated offsets, e.g. "1,2,3"
        offsets = [int(x, 0) for x in sys.argv[3].split(",")]
        scen = lambda orig: scenario_scan(orig, offsets)  # noqa: E731
    out = "docs/captures"
    os.makedirs(out, exist_ok=True)
    wav_path = os.path.join(out, f"mute_probe_{mode}_{(sys.argv[3] if len(sys.argv) > 3 else '').replace(',', '-')}.wav")
    with RawMidi() as dev:
        orig = dev.read(p.PRESET_SPACE, slot * 16, 16)
        base = p.LIVE_BIT + slot * 16

        def apply(actions):
            for act in actions:
                if act[0] == "b":
                    dev.request(p.live_write(p.PRESET_SPACE, base + act[1], bytes([act[2]])))
                else:
                    dev.request(p.live_write(p.PRESET_SPACE, base, bytes(act[1])))

        steps = scen(orig)
        rec = subprocess.Popen(["pw-record", "--target", SOURCE, "--rate", str(RATE), "--channels", "1",
                                "--format", "s16", wav_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.monotonic()
        times = []
        try:
            time.sleep(0.5)
            for name, actions, key in steps:
                apply(actions)
                t1 = time.monotonic() - t0
                print(f"{t1:5.1f}s {name}", flush=True)
                time.sleep(STEP if mode == "recovery" else (1.2 if key else 0.5))
                times.append((name, t1, time.monotonic() - t0, key))
        finally:
            dev.request(p.live_write(p.PRESET_SPACE, base, bytes(orig)))
            # un-stick the amp block in case the last step left it muted
            dev.request(p.live_write(p.PRESET_SPACE, base + 12, bytes([0])))
            dev.request(p.live_write(p.PRESET_SPACE, base + 12, bytes([orig[12]])))
            rec.terminate()
            rec.wait()
            print("restored:", dev.read(p.PRESET_SPACE, slot * 16, 16).hex(" "))

    w = wave.open(wav_path)
    pcm = array.array("h", w.readframes(w.getnframes()))
    print()
    results = []
    for name, t1, t2, key in times:
        if mode != "recovery" and key is None and name != "baseline":
            continue
        state, db, alive = analyse(pcm, t1, t2)
        bright = centroid(pcm, t1, t2)
        results.append({"name": name, "key": key, "state": state, "db": db, "bright": bright})
        print(f"{state:5}  {db:7.1f} dBFS  bright {bright:6.0f} Hz  active {alive:4.0%}  {name}")
    import json
    json.dump(results, open(wav_path.replace(".wav", ".json"), "w"), indent=1)


if __name__ == "__main__":
    main()
