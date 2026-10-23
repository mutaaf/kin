#!/bin/sh
# Run the Unity editor headlessly against unity/MyKin.
#   scripts/unity-batch.sh <log-file> [extra Unity args...]
#   e.g. scripts/unity-batch.sh /tmp/u.log -executeMethod KinSetup.SetupProject
#   GRAPHICS=1 scripts/unity-batch.sh /tmp/u.log -executeMethod KinProof.Capture
# Exits with Unity's exit code; prints compile errors from the log.
set -u
cd "$(dirname "$0")/.."
UNITY="${UNITY:-/Applications/Unity/Hub/Editor/6000.6.7f1/Unity.app/Contents/MacOS/Unity}"
LOG="$1"; shift
GFX="-nographics"
[ "${GRAPHICS:-0}" = "1" ] && GFX=""   # GRAPHICS=1: real Metal device (renders, screenshots)
"$UNITY" -batchmode $GFX -quit -projectPath "$PWD/unity/MyKin" -logFile "$LOG" "$@"
code=$?
grep -E "error CS[0-9]+|Scripts have compiler errors|KIN_[A-Z_]+|Exception:" "$LOG" | sort -u | head -40
echo "unity exit=$code"
exit $code
