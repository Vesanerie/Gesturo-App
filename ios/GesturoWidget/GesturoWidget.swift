// GesturoWidget — Widget Extension entry point.
// Bundles all Gesturo widgets into a single WidgetBundle.

import WidgetKit
import SwiftUI

@main
struct GesturoWidgetBundle: WidgetBundle {
    var body: some Widget {
        PoseOfDayWidget()
    }
}
