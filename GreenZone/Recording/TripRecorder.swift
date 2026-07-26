import Foundation
import CoreLocation
import Observation

/// Drives an active trip: consumes GPS updates, paints the route using the
/// active classification, and tracks live distance and duration.
@Observable
@MainActor
final class TripRecorder {
    private(set) var isRecording = false
    private(set) var segments: [RouteSegment] = []
    private(set) var notes: [TripNote] = []
    private(set) var distanceMeters: Double = 0
    private(set) var elapsedSeconds: Double = 0
    private(set) var lastCoordinate: CLLocationCoordinate2D?
    private(set) var authorizationStatus: CLAuthorizationStatus

    var legend: [Classification]
    var activeClassificationId: String

    private(set) var startedAt: Date?
    private var name: String = ""

    private let location = LocationManager()
    private var timer: Timer?

    init(legend: [Classification]) {
        self.legend = legend
        self.activeClassificationId = legend.first?.id ?? DefaultLegend.greenId
        self.authorizationStatus = CLLocationManager().authorizationStatus

        location.onLocation = { [weak self] loc in
            Task { @MainActor in self?.ingest(loc) }
        }
        location.onAuthChange = { [weak self] status in
            Task { @MainActor in self?.authorizationStatus = status }
        }
    }

    var activeClassification: Classification? {
        legend.first { $0.id == activeClassificationId }
    }

    func requestAuthorization() {
        location.requestAuthorization()
    }

    func requestAlwaysAuthorization() {
        location.requestAlwaysAuthorization()
    }

    // MARK: - Recording lifecycle

    func start(name: String) {
        guard !isRecording else { return }
        self.name = name
        segments = []
        notes = []
        distanceMeters = 0
        elapsedSeconds = 0
        startedAt = Date()
        isRecording = true

        location.start()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    /// Finish recording and build the immutable `Trip` to persist. Returns nil
    /// if nothing was recorded.
    func finish() -> Trip? {
        guard isRecording, let startedAt else { return nil }
        isRecording = false
        location.stop()
        timer?.invalidate()
        timer = nil

        let endedAt = Date()
        let merged = SegmentOps.mergeAllSameClassification(segments)
        let distance = GeoMath.distance(of: merged)

        guard !merged.isEmpty else { return nil }

        return Trip(
            name: name.isEmpty ? defaultTripName(startedAt) : name,
            startedAt: startedAt,
            endedAt: endedAt,
            durationSeconds: endedAt.timeIntervalSince(startedAt),
            distanceMeters: distance,
            segments: merged,
            notes: notes,
            photos: [],
            legend: legend
        )
    }

    func cancel() {
        isRecording = false
        location.stop()
        timer?.invalidate()
        timer = nil
    }

    // MARK: - User actions

    func selectClassification(_ id: String) {
        activeClassificationId = id
    }

    func addNote(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        notes.append(TripNote(text: trimmed,
                              lat: lastCoordinate?.latitude,
                              lng: lastCoordinate?.longitude))
    }

    // MARK: - Internals

    private func ingest(_ location: CLLocation) {
        guard isRecording else { return }
        let point = RoutePoint(location)

        let previousLast = segments.last?.points.last
        segments = SegmentOps.appendPoint(segments, point: point, classificationId: activeClassificationId)

        if let previousLast {
            distanceMeters += GeoMath.haversineMeters(previousLast, point)
        }
        lastCoordinate = point.coordinate
    }

    private func tick() {
        guard let startedAt else { return }
        elapsedSeconds = Date().timeIntervalSince(startedAt)
    }

    private func defaultTripName(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Trip \(formatter.string(from: date))"
    }
}
