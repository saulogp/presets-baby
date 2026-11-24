#!/usr/bin/env bash
# Bridge an Android phone (USB in "MIDI" mode) to the Cube Baby through this PC,
# using ALSA sequencer connections in both directions. Ctrl+C removes them.
#
#   phone (Chrome + app) <--USB MIDI--> PC (aconnect) <--USB MIDI--> Cube Baby
#
# Usage: tools/bridge.sh            # waits for the phone and the pedal, then connects
set -euo pipefail

PEDAL_RE='USB2\.0 Device'
IGNORE_RE='System|Midi Through|PipeWire'

# Print "client:port name" for every sequencer port that has a client name.
list_ports() {
  aconnect -l | awk '
    /^client [0-9]+:/ { c=$2; sub(":","",c); name=$0; sub(/^client [0-9]+: \x27/,"",name); sub(/\x27.*/,"",name) }
    /^    [0-9]+ \x27/ { p=$1; print c ":" p "\t" name }'
}

find_port() { list_ports | grep -E "$1" | grep -vE "$IGNORE_RE" | head -1 | cut -f1; }

echo "Waiting for the Cube Baby and the phone (set the phone's USB mode to MIDI)..."
while true; do
  pedal=$(find_port "$PEDAL_RE" || true)
  phone=$(list_ports | grep -vE "$PEDAL_RE|$IGNORE_RE" | head -1 | cut -f1 || true)
  if [[ -n "$pedal" && -n "$phone" ]]; then break; fi
  sleep 1
done

phone_name=$(list_ports | grep -F "$phone" | cut -f2)
echo "Pedal: $pedal   Phone: $phone ($phone_name)"

cleanup() {
  aconnect -d "$phone" "$pedal" 2>/dev/null || true
  aconnect -d "$pedal" "$phone" 2>/dev/null || true
  echo; echo "Bridge removed."
}
trap cleanup EXIT INT TERM

aconnect "$phone" "$pedal"
aconnect "$pedal" "$phone"
echo "Bridge active (both directions). Open the app on the phone and tap Conectar."
echo "Press Ctrl+C to stop."
while sleep 2; do
  # stop if either side disappears
  list_ports | grep -qF "$pedal" || { echo "Pedal disconnected."; exit 0; }
  list_ports | grep -qF "$phone" || { echo "Phone disconnected."; exit 0; }
done
