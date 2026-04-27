// GesturoWidgetBridge — Capacitor plugin that lets the JS layer write
// daily-pose data into the App Group shared UserDefaults, and trigger
// a WidgetKit timeline reload so the widget picks up the new data.
//
// Called from mobile-shim.js after each successful loadR2().

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

    /// Write daily pose data to the shared App Group and reload widget timelines.
    /// Expected call.data keys: poseURL (String), category (String), streak (Int), isPro (Bool), date (String ISO)
    @objc func updateDailyPose(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.reject("Cannot open App Group UserDefaults")
            return
        }

        let poseURL = call.getString("poseURL") ?? ""
        let category = call.getString("category") ?? ""
        let streak = call.getInt("streak") ?? 0
        let isPro = call.getBool("isPro") ?? false
        let date = call.getString("date") ?? ""

        defaults.set(poseURL, forKey: "dailyPoseURL")
        defaults.set(category, forKey: "dailyPoseCategory")
        defaults.set(streak, forKey: "currentStreak")
        defaults.set(isPro, forKey: "isPro")
        defaults.set(date, forKey: "dailyPoseDate")

        // Force widget refresh
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }

        call.resolve(["ok": true])
    }
}
