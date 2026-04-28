// PoseOfDayView — SwiftUI views for small / medium / large widget sizes.
// Design tokens match the main Gesturo app.

import SwiftUI
import WidgetKit

// MARK: - Design tokens

private let bgColor = Color(red: 10/255, green: 14/255, blue: 24/255)
private let accentPeach = Color(red: 232/255, green: 160/255, blue: 136/255)
private let mutedText = Color(red: 74/255, green: 88/255, blue: 112/255)
private let streakGold = Color(red: 240/255, green: 192/255, blue: 64/255)
private let lavender = Color(red: 184/255, green: 160/255, blue: 216/255)

// MARK: - Main entry view

struct PoseOfDayView: View {
    var entry: PoseOfDayEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                SmallView(entry: entry)
            case .systemMedium:
                MediumView(entry: entry)
            case .systemLarge:
                LargeView(entry: entry)
            default:
                SmallView(entry: entry)
            }
        }
        .modifier(WidgetBackgroundModifier())
    }
}

// MARK: - Small (2x2): image fills + gradient bottom + title

private struct SmallView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(url: entry.imageURL)

                LinearGradient(
                    colors: [.clear, bgColor.opacity(0.9)],
                    startPoint: UnitPoint(x: 0.5, y: 0.4),
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 2) {
                    Text("CHALLENGE")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(lavender)
                    Text(entry.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                }
                .padding(14)
            }
        }
    }
}

// MARK: - Medium (4x2): image left + info right + CTA

private struct MediumView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            HStack(spacing: 0) {
                RemoteImage(url: entry.imageURL)
                    .frame(maxWidth: .infinity)

                VStack(alignment: .leading, spacing: 5) {
                    Text("CHALLENGE")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(lavender)

                    Text(entry.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(accentPeach)
                        .lineLimit(2)

                    if !entry.subtitle.isEmpty {
                        Text(entry.subtitle)
                            .font(.system(size: 11))
                            .foregroundColor(mutedText)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 4)

                    Text("Participer")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(lavender)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Large (4x4): big image + gradient overlay + CTA

private struct LargeView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottom) {
                RemoteImage(url: entry.imageURL)

                LinearGradient(
                    colors: [.clear, bgColor.opacity(0.95)],
                    startPoint: UnitPoint(x: 0.5, y: 0.3),
                    endPoint: .bottom
                )

                VStack(spacing: 8) {
                    Text("CHALLENGE")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(lavender)

                    Text(entry.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(accentPeach)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)

                    HStack(spacing: 14) {
                        if entry.streak > 0 {
                            Text("\u{1F525} \(entry.streak)j")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(streakGold)
                        }

                        Text("Participer")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 9)
                            .background(lavender)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 26)
            }
        }
    }
}

// MARK: - Reusable components

/// Remote image via AsyncImage — SwiftUI handles caching
private struct RemoteImage: View {
    let url: URL?

    var body: some View {
        if let url = url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    fallbackView
                default:
                    ZStack {
                        bgColor
                        ProgressView().tint(lavender)
                    }
                }
            }
        } else {
            fallbackView
        }
    }

    private var fallbackView: some View {
        ZStack {
            bgColor
            Image("GesturoLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 40, height: 40)
                .opacity(0.3)
        }
    }
}

/// Placeholder shown when no data is available
private struct PlaceholderView: View {
    var body: some View {
        ZStack {
            bgColor
            VStack(spacing: 10) {
                Image("GesturoLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Text("Challenge du jour")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)

                Text("Ouvrir l'app pour activer")
                    .font(.system(size: 11))
                    .foregroundColor(mutedText)
            }
        }
    }
}

// MARK: - iOS 16/17 background compat

private struct WidgetBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(bgColor, for: .widget)
        } else {
            content.background(bgColor)
        }
    }
}

// MARK: - Preview

#if DEBUG
struct PoseOfDayView_Previews: PreviewProvider {
    static var previews: some View {
        let entry = PoseOfDayEntry(
            date: .now,
            imageURL: URL(string: "https://example.com/pose.jpg"),
            title: "Dessinez un chat assis",
            subtitle: "Poses dynamiques",
            streak: 12,
            challengeId: "abc123",
            isEmpty: false
        )
        let empty = PoseOfDayEntry(
            date: .now,
            imageURL: nil,
            title: "",
            subtitle: "",
            streak: 0,
            challengeId: nil,
            isEmpty: true
        )

        Group {
            PoseOfDayView(entry: entry)
                .previewContext(WidgetPreviewContext(family: .systemSmall))
                .previewDisplayName("Small")

            PoseOfDayView(entry: entry)
                .previewContext(WidgetPreviewContext(family: .systemMedium))
                .previewDisplayName("Medium")

            PoseOfDayView(entry: entry)
                .previewContext(WidgetPreviewContext(family: .systemLarge))
                .previewDisplayName("Large")

            PoseOfDayView(entry: empty)
                .previewContext(WidgetPreviewContext(family: .systemMedium))
                .previewDisplayName("Empty state")
        }
    }
}
#endif
