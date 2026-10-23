#!/bin/sh
# One idempotent command: install, verify, and start KIN locally. Re-running is cheap.
set -e
cd "$(dirname "$0")/.."

# Node 22+ is required (vite 8, vitest 4, native WebSocket/BroadcastChannel in tests).
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Need Node >= 22"; exit 1; }

# Install only when package-lock changed since the last install (avoids a 20s no-op).
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm install; fi

# Fast gate: types + unit/property tests (the crossing invariant must hold before you demo it).
npx tsc --noEmit
npx vitest run --reporter=dot

# iOS: Xcode, not CommandLineTools, must be the developer dir, or xcodebuild fails confusingly.
if [ "$(uname)" = "Darwin" ]; then
  case "$(xcode-select -p 2>/dev/null)" in
    *Xcode.app*) echo "✓ Xcode active (npm run ios:sim for iPhone + iPad)";;
    *) echo "! xcode-select points at CommandLineTools — export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer for iOS builds";;
  esac
fi

echo "→ http://localhost:5188/kin/   (open a second window from Gather → 'Open a friend window')"
exec npx vite --port 5188
