// Plugin Capacitor natif pour le scan de document iOS via VisionKit
// Utilise VNDocumentCameraViewController (API officielle Apple, comme
// l'app Notes) — détection de contours + correction de perspective + filtres
// automatiques. Zéro dépendance externe, iOS 13+.
//
// Exposé côté JS sous le nom "VisionKitScanner".
// Méthode : scanDocument() → { scannedImages: [base64Jpeg] } (array vide si annulé)

import Foundation
import Capacitor
import VisionKit
import UIKit

@objc(VisionKitScannerPlugin)
public class VisionKitScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionKitScannerPlugin"
    public let jsName = "VisionKitScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": VNDocumentCameraViewController.isSupported])
    }

    @objc func scanDocument(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("VisionKit document scanner is not supported on this device")
            return
        }

        self.pendingCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            self.bridge?.viewController?.present(scanner, animated: true, completion: nil)
        }
    }
}

extension VisionKitScannerPlugin: VNDocumentCameraViewControllerDelegate {
    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true, completion: nil)
        guard let call = pendingCall else { return }

        var images: [String] = []
        for i in 0..<scan.pageCount {
            let image = scan.imageOfPage(at: i)
            // JPEG quality 0.9 — bon compromis taille/qualité pour un dessin
            if let data = image.jpegData(compressionQuality: 0.9) {
                images.append(data.base64EncodedString())
            }
        }

        call.resolve(["scannedImages": images])
        self.pendingCall = nil
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true, completion: nil)
        // L'user a annulé — on renvoie un array vide, pas une erreur
        pendingCall?.resolve(["scannedImages": []])
        self.pendingCall = nil
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true, completion: nil)
        pendingCall?.reject("Scan failed: \(error.localizedDescription)")
        self.pendingCall = nil
    }
}
