import SwiftUI

struct RootView: View {
    @Environment(TripStore.self) private var store
    @Environment(AppSettings.self) private var settings

    @State private var recordingActive = false

    var body: some View {
        NavigationStack {
            TripsListView(onStartTrip: { recordingActive = true })
        }
        .fullScreenCover(isPresented: $recordingActive) {
            RecordTripView(legend: settings.startingLegend()) { finishedTrip in
                if let finishedTrip {
                    store.add(finishedTrip)
                }
                recordingActive = false
            }
        }
    }
}
