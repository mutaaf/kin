#!/bin/sh
# Vendor System.Text.Json (+ its netstandard2.1 dependencies Unity doesn't ship) into
# unity/MyKin/Assets/Plugins/SystemTextJson for IL2CPP player builds.
set -e
cd "$(dirname "$0")/../unity/MyKin/Tools/stj"
echo "public class Stj {}" > Stj.cs
"$HOME/.dotnet/dotnet" publish -c Release -o out >/dev/null
DEST=../../Assets/Plugins/SystemTextJson
mkdir -p "$DEST"
for f in System.Text.Json System.Text.Encodings.Web Microsoft.Bcl.AsyncInterfaces; do
  cp "out/$f.dll" "$DEST/"
done
ls "$DEST"
