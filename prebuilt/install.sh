#!/bin/bash
# Swap the fork's eufy-sdk bundle into the local bridge add-on. Usage: install.sh [rollback]
set -euo pipefail
SLUG=local_eufy_sdk_bridge_sdk050
C=addon_$SLUG
URL=https://raw.githubusercontent.com/azielman/eufy-sdk/build/ff09-mqtt-fallback/prebuilt/index.js
SHA=7a61998a0d95b1c235f28718638ff27984a270653f2c4c0898e0c427a1ca716c
D=docker; $D ps >/dev/null 2>&1 || D="sudo docker"
$D ps --format '{{.Names}}' | grep -qx "$C" || { echo "Add-on container $C not running. Containers:"; $D ps --format '{{.Names}}'; exit 1; }
F=$($D exec $C sh -c 'find / -path "*@mega-yfue/eufy-sdk/dist/index.js" -not -path "/proc/*" 2>/dev/null | head -1')
[ -n "$F" ] || { echo "eufy-sdk dist/index.js not found in $C"; exit 1; }
echo "Target: $F"
if [ "${1:-}" = rollback ]; then
  $D exec $C cp "$F.orig" "$F"; echo "Restored original."
else
  T=$(mktemp); curl -fsSL "$URL" -o "$T"
  echo "$SHA  $T" | sha256sum -c - >/dev/null || { echo "Checksum mismatch, aborting."; exit 1; }
  $D exec $C sh -c "[ -f '$F.orig' ] || cp '$F' '$F.orig'"
  $D cp "$T" "$C:$F"; rm -f "$T"
  echo "Installed fork build (fallback markers: $($D exec $C grep -c ff09MqttFallbackUntil "$F"))."
fi
echo "Restarting bridge add-on..."
ha addons restart $SLUG >/dev/null 2>&1 || $D restart $C >/dev/null
echo "Done. Now press Lock / Unlock / Lock on lock.side_door, then send Claude the bridge log."
