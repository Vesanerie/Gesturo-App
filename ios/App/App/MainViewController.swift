// Custom Capacitor Bridge View Controller.
// Sert UNIQUEMENT à enregistrer les plugins Capacitor locaux (in-app) au
// démarrage. Les plugins externes (via SPM / CocoaPods) sont découverts
// automatiquement, mais ceux qu'on écrit directement dans le target App
// doivent être enregistrés manuellement via `registerPluginInstance`.

import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VisionKitScannerPlugin())
    }
}
