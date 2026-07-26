import SwiftUI

/// Loads the trip from the store into editable local state and persists edits.
struct TripDetailView: View {
    @Environment(TripStore.self) private var store

    let tripId: UUID
    @State private var trip: Trip?

    var body: some View {
        Group {
            if trip != nil {
                TripDetailContent(
                    trip: Binding(
                        get: { trip ?? placeholder },
                        set: { trip = $0 }
                    ),
                    commit: commit
                )
            } else {
                ContentUnavailableView("Trip not found", systemImage: "questionmark.circle")
            }
        }
        .onAppear {
            if trip == nil { trip = store.trip(withId: tripId) }
        }
    }

    private var placeholder: Trip {
        Trip(name: "", startedAt: Date(), legend: DefaultLegend.standard())
    }

    /// Recompute derived values and persist after any edit.
    private func commit() {
        guard var updated = trip else { return }
        updated.distanceMeters = GeoMath.distance(of: updated.segments)
        trip = updated
        store.update(updated)
    }
}
