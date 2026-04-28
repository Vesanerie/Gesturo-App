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

// MARK: - Load image from App Group container

private func loadLocalImage(_ path: String?) -> UIImage? {
    guard let path = path, let url = URL(string: path) else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return UIImage(data: data)
}

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

// MARK: - Small (2x2): image + challenge label overlay

private struct SmallView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottomLeading) {
                LocalImage(path: entry.localImagePath, cornerRadius: 16)

                LinearGradient(
                    colors: [.clear, bgColor.opacity(0.85)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text("CHALLENGE")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(lavender)
                    Text(entry.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                }
                .padding(12)
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
            HStack(spacing: 12) {
                LocalImage(path: entry.localImagePath, cornerRadius: 14)
                    .frame(maxWidth: .infinity)

                VStack(alignment: .leading, spacing: 6) {
                    Spacer()

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

                    Spacer()

                    Text("Participer")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 7)
                        .background(lavender)
                        .clipShape(Capsule())

                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(4)
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
                LocalImage(path: entry.localImagePath, cornerRadius: 20)

                LinearGradient(
                    colors: [.clear, bgColor.opacity(0.95)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 130)
                .clipShape(
                    RoundedCorner(radius: 20, corners: [.bottomLeft, .bottomRight])
                )

                VStack(spacing: 8) {
                    Text("CHALLENGE")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(lavender)

                    Text(entry.title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(accentPeach)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 16) {
                        if entry.streak > 0 {
                            Text("\u{1F525} \(entry.streak) jours")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(streakGold)
                        }

                        Text("Participer")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 8)
                            .background(lavender)
                            .clipShape(Capsule())
                    }
                }
                .padding(.bottom, 16)
            }
        }
    }
}

// MARK: - Reusable components

/// Load image from local App Group file path
private struct LocalImage: View {
    let path: String?
    let cornerRadius: CGFloat

    var body: some View {
        if let uiImage = loadLocalImage(path) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            ZStack {
                bgColor
                Image("GesturoLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 40, height: 40)
                    .opacity(0.3)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
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

/// Helper shape for rounding only specific corners
private struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Preview

#if DEBUG
struct PoseOfDayView_Previews: PreviewProvider {
    static var previews: some View {
        let entry = PoseOfDayEntry(
            date: .now,
            localImagePath: nil,
            title: "Dessinez un chat assis",
            subtitle: "Poses dynamiques",
            streak: 12,
            challengeId: "abc123",
            isEmpty: false
        )
        let empty = PoseOfDayEntry(
            date: .now,
            localImagePath: nil,
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
