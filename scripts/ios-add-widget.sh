#!/bin/sh
# Kept for existing docs/commands: installs the Live Activity into the Capacitor app.
# The real (engine-agnostic) installer is scripts/ios-la-install.sh.
set -e
exec sh "$(dirname "$0")/ios-la-install.sh" "$@"
