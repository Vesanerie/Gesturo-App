// PoseOfDayView — SwiftUI views for small / medium / large widget sizes.
// Design tokens match the main Gesturo app:
//   - Background: #0a0e18
//   - Accent (peach): #e8a088
//   - Muted text: #4a5870
//   - Streak gold: #f0c040
//   - Primary (lavender): #b8a0d8

import SwiftUI
import WidgetKit

// MARK: - Design tokens

private let bgColor = Color(red: 10/255, green: 14/255, blue: 24/255)
private let accentPeach = Color(red: 232/255, green: 160/255, blue: 136/255)
private let mutedText = Color(red: 74/255, green: 88/255, blue: 112/255)
private let streakGold = Color(red: 240/255, green: 192/255, blue: 64/255)
private let lavender = Color(red: 184/255, green: 160/255, blue: 216/255)

// MARK: - Main entry view (dispatches by widget family)

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

// MARK: - Small (2x2): image only, rounded corners, tap opens app

private struct SmallView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            PoseImage(url: entry.imageURL, cornerRadius: 16)
        }
    }
}

// MARK: - Medium (4x2): image left + text right

private struct MediumView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            HStack(spacing: 12) {
                PoseImage(url: entry.imageURL, cornerRadius: 16)
                    .frame(maxWidth: .infinity)

                VStack(alignment: .leading, spacing: 6) {
                    Spacer()
                    Text("Pose du jour")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(accentPeach)

                    Text(entry.categoryName)
                        .font(.system(size: 11))
                        .foregroundColor(mutedText)
                        .lineLimit(1)

                    Spacer()

                    Text("Dessiner")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(lavender.opacity(0.3))
                        .clipShape(Capsule())

                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(4)
        }
    }
}

// MARK: - Large (4x4): big image + gradient overlay at bottom

private struct LargeView: View {
    let entry: PoseOfDayEntry

    var body: some View {
        if entry.isEmpty {
            PlaceholderView()
        } else {
            ZStack(alignment: .bottom) {
                PoseImage(url: entry.imageURL, cornerRadius: 20)

                // Gradient overlay
                LinearGradient(
                    colors: [.clear, bgColor.opacity(0.9)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 100)
                .clipShape(
                    RoundedCorner(radius: 20, corners: [.bottomLeft, .bottomRight])
                )

                // Text overlay
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pose du jour")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(accentPeach)

                    HStack {
                        Text(entry.categoryName)
                            .font(.system(size: 11))
                            .foregroundColor(mutedText)
                            .lineLimit(1)

                        Spacer()

                        if entry.streak > 0 {
                            Text("\u{1F525} \(entry.streak) jours")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(streakGold)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
            }
        }
    }
}

// MARK: - Reusable components

/// Async image loader with object-fit cover
private struct PoseImage: View {
    let url: URL?
    let cornerRadius: CGFloat

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
                    ProgressView()
                        .tint(lavender)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
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
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// Placeholder shown when no data is available (first launch, not logged in)
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

                Text("Pose du jour")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)

                Text("Ouvrir l'app pour activer")
                    .font(.system(size: 11))
                    .foregroundColor(mutedText)
            }
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
            categoryName: "Poses dynamiques",
            streak: 12,
            isEmpty: false
        )
        let empty = PoseOfDayEntry(
            date: .now,
            imageURL: nil,
            categoryName: "",
            streak: 0,
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
