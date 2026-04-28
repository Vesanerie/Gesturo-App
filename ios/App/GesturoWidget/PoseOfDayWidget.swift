// PoseOfDayWidget — WidgetKit provider + entry for the Gesturo widget.
// Reads pre-cached data from the App Group shared UserDefaults written by the
// main Gesturo app (via GesturoWidgetBridge Capacitor plugin).
// The image is pre-downloaded by the bridge — no network requests here.

import WidgetKit
import SwiftUI

// MARK: - Shared constants

private let appGroupID = "group.art.gesturo.shared"
private let deepLinkBase = "com.gesturo.app://"

// MARK: - Timeline Entry

struct PoseOfDayEntry: TimelineEntry {
    let date: Date
    let localImagePath: String?
    let title: String
    let subtitle: String
    let streak: Int
    let challengeId: String?
    let isEmpty: Bool
}

// MARK: - Timeline Provider

struct PoseOfDayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PoseOfDayEntry {
        PoseOfDayEntry(date: .now, localImagePath: nil, title: "Challenge du jour", subtitle: "", streak: 0, challengeId: nil, isEmpty: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (PoseOfDayEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PoseOfDayEntry>) -> Void) {
        let entry = currentEntry()
        let calendar = Calendar.current
        let tomorrow = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: .now)!)
        let timeline = Timeline(entries: [entry], policy: .after(tomorrow))
        completion(timeline)
    }

    private func currentEntry() -> PoseOfDayEntry {
        guard let defaults = UserDefaults(suiteName: appGroupID) else {
            return PoseOfDayEntry(date: .now, localImagePath: nil, title: "", subtitle: "", streak: 0, challengeId: nil, isEmpty: true)
        }

        let storedDate = defaults.string(forKey: "widgetDate") ?? ""
        let title = defaults.string(forKey: "widgetTitle") ?? ""
        let subtitle = defaults.string(forKey: "widgetSubtitle") ?? ""
        let streak = defaults.integer(forKey: "currentStreak")
        let challengeId = defaults.string(forKey: "widgetChallengeId")
        let imagePath = defaults.string(forKey: "widgetImagePath")

        // Check if the stored date is still today
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withFullDate]
        let today = isoFormatter.string(from: .now)
        let isEmpty = storedDate != today || title.isEmpty

        return PoseOfDayEntry(
            date: .now,
            localImagePath: isEmpty ? nil : imagePath,
            title: title,
            subtitle: subtitle,
            streak: streak,
            challengeId: challengeId,
            isEmpty: isEmpty
        )
    }
}

// MARK: - Widget definition

struct PoseOfDayWidget: Widget {
    let kind: String = "PoseOfDayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PoseOfDayProvider()) { entry in
            let deepLink: URL = {
                if let cid = entry.challengeId, !cid.isEmpty {
                    return URL(string: "\(deepLinkBase)challenge?id=\(cid)") ?? URL(string: deepLinkBase)!
                }
                return URL(string: "\(deepLinkBase)daily-pose")!
            }()
            PoseOfDayView(entry: entry)
                .widgetURL(deepLink)
        }
        .configurationDisplayName("Gesturo")
        .description("Le challenge du jour — dessinez et partagez !")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
