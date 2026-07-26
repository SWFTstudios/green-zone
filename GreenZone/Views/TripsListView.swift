import SwiftUI

struct TripsListView: View {
    @Environment(TripStore.self) private var store
    @Environment(AppSettings.self) private var settings

    let onStartTrip: () -> Void
    @State private var showSettings = false

    var body: some View {
        Group {
            if store.trips.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(store.trips) { trip in
                        NavigationLink {
                            TripDetailView(tripId: trip.id)
                        } label: {
                            TripRow(trip: trip)
                        }
                    }
                    .onDelete(perform: deleteTrips)
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("GreenZone")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onStartTrip) {
                Label("Start Trip", systemImage: "record.circle")
                    .font(.title3.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 54)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack { SettingsView() }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No trips yet", systemImage: "map")
        } description: {
            Text("Tap Start Trip and paint your route green, yellow, or red as you drive or walk.")
        }
    }

    private func deleteTrips(at offsets: IndexSet) {
        for index in offsets {
            store.delete(store.trips[index])
        }
    }
}

/// One row in the trips list: name, timing, distance, and a proportional color bar.
private struct TripRow: View {
    let trip: Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(trip.name)
                .font(.headline)
            HStack(spacing: 12) {
                Label(Format.dateTime(trip.createdAt), systemImage: "calendar")
                Label(Format.duration(trip.durationSeconds), systemImage: "clock")
                Label(Format.distance(trip.distanceMeters), systemImage: "ruler")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            ColorSummaryBar(trip: trip)
                .frame(height: 8)
        }
        .padding(.vertical, 4)
    }
}

/// Horizontal bar showing the share of the route in each classification, by distance.
private struct ColorSummaryBar: View {
    let trip: Trip

    private var shares: [(color: Color, weight: Double)] {
        trip.segments.map { seg in
            let color = trip.classification(for: seg.classificationId)?.color ?? .gray
            return (color, max(GeoMath.length(of: seg.points), 0.0001))
        }
    }

    var body: some View {
        GeometryReader { geo in
            let total = shares.reduce(0) { $0 + $1.weight }
            HStack(spacing: 0) {
                ForEach(Array(shares.enumerated()), id: \.offset) { _, share in
                    Rectangle()
                        .fill(share.color)
                        .frame(width: total > 0 ? geo.size.width * (share.weight / total) : 0)
                }
            }
            .clipShape(Capsule())
        }
    }
}
