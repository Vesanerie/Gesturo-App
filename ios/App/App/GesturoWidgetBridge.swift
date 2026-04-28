// GesturoWidgetBridge — Capacitor plugin that lets the JS layer write
// challenge/daily-pose data into the App Group shared container, and trigger
// a WidgetKit timeline reload so the widget picks up the new data.
//
// The image is downloaded and stored locally because WidgetKit views cannot
// make network requests at render time.

import Capacitor
import WidgetKit

@objc(GesturoWidgetBridge)
public class GesturoWidgetBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GesturoWidgetBridge"
    public let jsName = "GesturoWidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateDailyPose", returnType: CAPPluginReturnPromise)
    ]

    private let suiteName = "group.art.gesturo.shared"

    /// Write challenge/pose data to the shared App Group, download the image
    /// into the shared container, and reload widget timelines.
    @objc func updateDailyPose(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.reject("Cannot open App Group UserDefaults")
            return
        }

        let imageURL = call.getString("imageURL") ?? ""
        let title = call.getString("title") ?? ""
        let subtitle = call.getString("subtitle") ?? ""
        let streak = call.getInt("streak") ?? 0
        let challengeId = call.getString("challengeId") ?? ""
        let date = call.getString("date") ?? ""

        defaults.set(title, forKey: "widgetTitle")
        defaults.set(subtitle, forKey: "widgetSubtitle")
        defaults.set(streak, forKey: "currentStreak")
        defaults.set(challengeId, forKey: "widgetChallengeId")
        defaults.set(date, forKey: "widgetDate")

        // Download image to shared container so the widget can read it locally
        if let url = URL(string: imageURL) {
            let task = URLSession.shared.dataTask(with: url) { data, _, _ in
                if let data = data, let containerURL = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: self.suiteName
                ) {
                    let imgPath = containerURL.appendingPathComponent("widget-image.jpg")
                    try? data.write(to: imgPath)
                    defaults.set(imgPath.absoluteString, forKey: "widgetImagePath")
                }

                // Reload timelines on main thread after image is saved
                DispatchQueue.main.async {
                    if #available(iOS 14.0, *) {
                        WidgetCenter.shared.reloadAllTimelines()
                    }
                }
            }
            task.resume()
        } else {
            // No image URL — still reload
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }

        call.resolve(["ok": true])
    }
}
