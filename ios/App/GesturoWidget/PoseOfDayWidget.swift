// PoseOfDayWidget — WidgetKit provider + entry for the Gesturo widget.
// The provider downloads and resizes the image so the view never exceeds
// WidgetKit's archival pixel budget (~500K px for small widgets).

import UIKit
import WidgetKit
import SwiftUI

// MARK: - Shared constants

private let appGroupID = "group.art.gesturo.shared"
private let deepLinkBase = "com.gesturo.app://"
private let maxImageSide: CGFloat = 400  // keeps totalArea well under 500K

// MARK: - Timeline Entry

struct PoseOfDayEntry: TimelineEntry {
    let date: Date
    let image: UIImage?
    let title: String
    let subtitle: String
    let streak: Int
    let challengeId: String?
    let isEmpty: Bool
}

// MARK: - Timeline Provider

struct PoseOfDayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PoseOfDayEntry {
        PoseOfDayEntry(date: .now, image: nil, title: "Challenge du jour", subtitle: "", streak: 0, challengeId: nil, isEmpty: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (PoseOfDayEntry) -> Void) {
        completion(readEntry(image: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PoseOfDayEntry>) -> Void) {
        let defaults = UserDefaults(suiteName: appGroupID)
        let imageURLStr = defaults?.string(forKey: "widgetImageURL") ?? ""

        let finish: (UIImage?) -> Void = { img in
            let entry = self.readEntry(image: img)
            let calendar = Calendar.current
            let tomorrow = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: .now)!)
            let timeline = Timeline(entries: [entry], policy: .after(tomorrow))
            completion(timeline)
        }

        // Download + resize in the provider (allowed to do network here)
        guard let url = URL(string: imageURLStr), !imageURLStr.isEmpty else {
            finish(nil)
            return
        }

        let task = URLSession.shared.dataTask(with: url) { data, _, _ in
            var img: UIImage? = nil
            if let data = data, let original = UIImage(data: data) {
                img = Self.resize(original, maxSide: maxImageSide)
            }
            finish(img)
        }
        task.resume()
    }

    private func readEntry(image: UIImage?) -> PoseOfDayEntry {
        guard let defaults = UserDefaults(suiteName: appGroupID) else {
            return PoseOfDayEntry(date: .now, image: nil, title: "", subtitle: "", streak: 0, challengeId: nil, isEmpty: true)
        }

        let storedDate = defaults.string(forKey: "widgetDate") ?? ""
        let title = defaults.string(forKey: "widgetTitle") ?? ""
        let subtitle = defaults.string(forKey: "widgetSubtitle") ?? ""
        let streak = defaults.integer(forKey: "currentStreak")
        let challengeId = defaults.string(forKey: "widgetChallengeId")

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withFullDate]
        let today = isoFormatter.string(from: .now)
        let isEmpty = storedDate != today || title.isEmpty

        return PoseOfDayEntry(
            date: .now,
            image: isEmpty ? nil : image,
            title: title,
            subtitle: subtitle,
            streak: streak,
            challengeId: challengeId,
            isEmpty: isEmpty
        )
    }

    private static func resize(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let w = image.size.width
        let h = image.size.height
        guard max(w, h) > maxSide else { return image }
        let scale = maxSide / max(w, h)
        let newSize = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
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
