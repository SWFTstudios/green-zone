import Foundation
import Observation

/// Loads and persists trips as a single JSON file in the app's Documents
/// directory. Simple and robust for the MVP (no backend/sync).
@Observable
@MainActor
final class TripStore {
    private(set) var trips: [Trip] = []

    private let fileName = "trips.json"

    private var fileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent(fileName)
    }

    init() {
        load()
    }

    func load() {
        guard let data = try? Data(contentsOf: fileURL) else {
            trips = []
            return
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        trips = (try? decoder.decode([Trip].self, from: data)) ?? []
        sort()
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(trips) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    private func sort() {
        trips.sort { $0.createdAt > $1.createdAt }
    }

    // MARK: - CRUD

    func add(_ trip: Trip) {
        trips.append(trip)
        sort()
        persist()
    }

    func update(_ trip: Trip) {
        guard let idx = trips.firstIndex(where: { $0.id == trip.id }) else {
            add(trip)
            return
        }
        trips[idx] = trip
        sort()
        persist()
    }

    func delete(_ trip: Trip) {
        trips.removeAll { $0.id == trip.id }
        // Clean up any photos owned by this trip.
        for photo in trip.photos {
            PhotoStore.shared.delete(fileName: photo.fileName)
        }
        persist()
    }

    func trip(withId id: UUID) -> Trip? {
        trips.first { $0.id == id }
    }
}
