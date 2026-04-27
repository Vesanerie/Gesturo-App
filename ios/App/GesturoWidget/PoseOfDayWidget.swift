// PoseOfDayWidget — WidgetKit provider + entry for the "Pose du jour" widget.
// Reads pre-cached data from the App Group shared UserDefaults written by the
// main Gesturo app (via GesturoWidgetBridge Capacitor plugin).
// No network requests happen here — the app is the single source of truth.

import WidgetKit
import SwiftUI

// MARK: - Shared constants

private let appGroupID = "group.art.gesturo.shared"
private let deepLinkURL = URL(string: "com.gesturo.app://daily-pose")!

// MARK: - Timeline Entry

struct PoseOfDayEntry: TimelineEntry {
    let date: Date
    let imageURL: URL?
    let categoryName: String
    let streak: Int
    let isEmpty: Bool          // true when no data has been written yet
}

// MARK: - Timeline Provider

struct PoseOfDayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PoseOfDayEntry {
        PoseOfDayEntry(date: .now, imageURL: nil, categoryName: "Poses dynamiques", streak: 0, isEmpty: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (PoseOfDayEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PoseOfDayEntry>) -> Void) {
        let entry = currentEntry()

        // Next refresh at midnight local time (or in 1h if date is stale).
        let calendar = Calendar.current
        let tomorrow = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: .now)!)
        let refreshDate = tomorrow

        let timeline = Timeline(entries: [entry], policy: .after(refreshDate))
        completion(timeline)
    }

    // Read shared UserDefaults written by the Capacitor bridge.
    private func currentEntry() -> PoseOfDayEntry {
        guard let defaults = UserDefaults(suiteName: appGroupID) else {
            return PoseOfDayEntry(date: .now, imageURL: nil, categoryName: "", streak: 0, isEmpty: true)
        }

        let storedDateStr = defaults.string(forKey: "dailyPoseDate") ?? ""
        let urlStr = defaults.string(forKey: "dailyPoseURL") ?? ""
        let category = defaults.string(forKey: "dailyPoseCategory") ?? ""
        let streak = defaults.integer(forKey: "currentStreak")

        // Check if the stored date is still today.
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withFullDate]
        let today = isoFormatter.string(from: .now)

        let isEmpty = urlStr.isEmpty || storedDateStr != today
        let imageURL = URL(string: urlStr)

        return PoseOfDayEntry(
            date: .now,
            imageURL: isEmpty ? nil : imageURL,
            categoryName: category,
            streak: streak,
            isEmpty: isEmpty
        )
    }
}

// MARK: - Widget definition

struct PoseOfDayWidget: Widget {
    let kind: String = "PoseOfDayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PoseOfDayProvider()) { entry in
            PoseOfDayView(entry: entry)
                .widgetURL(deepLinkURL)
        }
        .configurationDisplayName("Pose du jour")
        .description("Une pose aléatoire chaque jour pour vous motiver à dessiner.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
