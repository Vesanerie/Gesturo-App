// GesturoWidgetBridge — Capacitor plugin that lets the JS layer write
// challenge/daily-pose data into the App Group shared UserDefaults, and
// trigger a WidgetKit timeline reload so the widget picks up the new data.
// The widget uses AsyncImage to load the image — no local download needed.

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

        defaults.set(imageURL, forKey: "widgetImageURL")
        defaults.set(title, forKey: "widgetTitle")
        defaults.set(subtitle, forKey: "widgetSubtitle")
        defaults.set(streak, forKey: "currentStreak")
        defaults.set(challengeId, forKey: "widgetChallengeId")
        defaults.set(date, forKey: "widgetDate")

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }

        call.resolve(["ok": true])
    }
}
