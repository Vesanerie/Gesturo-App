// PoseOfDayView — SwiftUI views for small / medium / large widget sizes.
// Images are pre-downloaded and resized by the provider — no network here.

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

// MARK: - Small (2x2)

private struct SmallView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottomLeading) {
                EntryImage(image: entry.image)

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

// MARK: - Medium (4x2)

private struct MediumView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            HStack(spacing: 0) {
                EntryImage(image: entry.image)
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

// MARK: - Large (4x4)

private struct LargeView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottom) {
                EntryImage(image: entry.image)

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

/// Display the pre-resized image, constrained to widget bounds via GeometryReader
/// so WidgetKit never archives a view larger than the widget itself.
private struct EntryImage: View {
    let image: UIImage?

    var body: some View {
        GeometryReader { geo in
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
            } else {
                ZStack {
                    bgColor
                    Image("GesturoLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 40, height: 40)
                        .opacity(0.3)
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
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
            image: nil,
            title: "Dessinez un chat assis",
            subtitle: "Poses dynamiques",
            streak: 12,
            challengeId: "abc123",
            isEmpty: false
        )
        let empty = PoseOfDayEntry(
            date: .now,
            image: nil,
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
