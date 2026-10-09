#!/usr/bin/env bash
# Compila kubo-voce (Parakeet v3 via FluidAudio) e lo copia in desktop/bin (ignorata da git). Serve un Mac con Apple
# Silicon e gli strumenti di Apple (xcode-select --install oppure Xcode). Ci vogliono qualche minuto e circa 1 GB in .build.
# I Command Line Tools 16.4 hanno due difetti che rompono il package manager di Swift; qui si aggirano senza toccare il
# sistema (come in Lode, da cui viene questo script):
#  1. PackageDescription.private.swiftinterface vecchio (febbraio 2024) che non corrisponde alla libreria → si usa una copia
#     dei file del package manager senza le interfacce private (SWIFTPM_CUSTOM_LIBS_DIR);
#  2. module.modulemap di SwiftBridging doppio (usr/include/swift e SDK) → lo si nasconde con una sovrapposizione (vfsoverlay).
# FluidAudio solo alla versione di Package.resolved, quella provata (--force-resolved-versions): se il file non combacia
# con Package.swift si ferma invece di scaricare l'ultima uscita. Dopo aver cambiato la versione in Package.swift:
# bash compila.sh --aggiorna, che riscrive Package.resolved (da leggere e mettere nel commit).
set -euo pipefail
BLOCCA=--force-resolved-versions; [ "${1:-}" = --aggiorna ] && BLOCCA=""
cd "$(dirname "$0")"
DEV="$(xcode-select -p)"; PM="$DEV/usr/lib/swift/pm"; [ -d "$PM" ] || PM="$DEV/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/pm"
rm -rf .pm && mkdir -p .pm && cp -R "$PM/." .pm/ && find .pm -name '*.private.swiftinterface' -delete
: > .pm/vuoto.modulemap
printf '{"version":0,"case-sensitive":"false","roots":[{"type":"file","name":"%s/usr/include/swift/module.modulemap","external-contents":"%s/.pm/vuoto.modulemap"}]}\n' "$DEV" "$PWD" > .pm/sovrapponi.yaml
O="$PWD/.pm/sovrapponi.yaml"
SWIFTPM_CUSTOM_LIBS_DIR="$PWD/.pm" swift build -c release ${BLOCCA:+"$BLOCCA"} -Xmanifest -vfsoverlay -Xmanifest "$O" -Xswiftc -vfsoverlay -Xswiftc "$O" -Xcc -ivfsoverlay -Xcc "$O"
mkdir -p ../bin && cp .build/release/kubo-voce ../bin/kubo-voce
echo "pronto: desktop/bin/kubo-voce"
