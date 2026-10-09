// swift-tools-version:6.0
// lumi-voce: l'orecchio di Lumi sul Mac. Parakeet TDT 0.6B v3 (NVIDIA, 25 lingue europee) sul Neural Engine, via
// FluidAudio (FluidInference, Apache 2.0). Offline e gratis. Viene da lode-voce (github.com/W1kicartel/lode, MIT, stesso
// autore): qui la lingua non è fissa, la riconosce il modello.
// FluidAudio è fermo alla versione compilata e provata (exact, e Package.resolved nel repository con lo stesso commit):
// lumi-voce finisce nel pacchetto dell'app, quindi una versione nuova entra solo con un commit da leggere.
// Per aggiornarla: cambia la versione qui, poi `bash compila.sh --aggiorna` (riscrive Package.resolved), prova la voce
// (test/voce-vera.mjs) e fai il commit di tutti e due i file.
import PackageDescription
let package = Package(
  name: "lumi-voce",
  platforms: [.macOS(.v14)],
  dependencies: [.package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5")],
  targets: [.executableTarget(name: "lumi-voce", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")])]
)
