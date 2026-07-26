import SwiftUI

@main
struct GreenZoneApp: App {
    @State private var store = TripStore()
    @State private var settings = AppSettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(settings)
        }
    }
}
