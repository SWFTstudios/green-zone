import Foundation
import CoreLocation

/// A single GPS sample captured along a route.
struct RoutePoint: Codable, Equatable, Hashable {
    var lat: Double
    var lng: Double
    var t: Date

    init(lat: Double, lng: Double, t: Date = Date()) {
        self.lat = lat
        self.lng = lng
        self.t = t
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

extension RoutePoint {
    init(_ location: CLLocation) {
        self.init(lat: location.coordinate.latitude,
                  lng: location.coordinate.longitude,
                  t: location.timestamp)
    }
}

/// A color classification with a user-facing meaning. The three built-in ones
/// (green/yellow/red) ship in the free version; Pro users can add custom ones.
struct Classification: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var colorHex: String
    var label: String
    var detail: String
    var builtin: Bool

    init(id: String = UUID().uuidString,
         colorHex: String,
         label: String,
         detail: String,
         builtin: Bool = false) {
        self.id = id
        self.colorHex = colorHex
        self.label = label
        self.detail = detail
        self.builtin = builtin
    }
}

/// A contiguous stretch of the route painted with one classification.
/// Adjacent segments share their boundary point so the line stays continuous.
struct RouteSegment: Codable, Identifiable, Equatable, Hashable {
    var id: UUID
    var classificationId: String
    var points: [RoutePoint]

    init(id: UUID = UUID(), classificationId: String, points: [RoutePoint]) {
        self.id = id
        self.classificationId = classificationId
        self.points = points
    }
}

struct TripNote: Codable, Identifiable, Equatable, Hashable {
    var id: UUID
    var text: String
    var at: Date
    var lat: Double?
    var lng: Double?

    init(id: UUID = UUID(), text: String, at: Date = Date(), lat: Double? = nil, lng: Double? = nil) {
        self.id = id
        self.text = text
        self.at = at
        self.lat = lat
        self.lng = lng
    }

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

struct TripPhoto: Codable, Identifiable, Equatable, Hashable {
    var id: UUID
    var fileName: String
    var caption: String
    var at: Date
    var lat: Double?
    var lng: Double?

    init(id: UUID = UUID(), fileName: String, caption: String = "", at: Date = Date(), lat: Double? = nil, lng: Double? = nil) {
        self.id = id
        self.fileName = fileName
        self.caption = caption
        self.at = at
        self.lat = lat
        self.lng = lng
    }
}

/// A saved trip: the full route (as colored segments), timing, distance,
/// notes, photos, and the legend that was in effect for the trip.
struct Trip: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    var createdAt: Date
    var startedAt: Date
    var endedAt: Date?
    var durationSeconds: Double
    var distanceMeters: Double
    var segments: [RouteSegment]
    var notes: [TripNote]
    var photos: [TripPhoto]
    var legend: [Classification]

    init(id: UUID = UUID(),
         name: String,
         createdAt: Date = Date(),
         startedAt: Date,
         endedAt: Date? = nil,
         durationSeconds: Double = 0,
         distanceMeters: Double = 0,
         segments: [RouteSegment] = [],
         notes: [TripNote] = [],
         photos: [TripPhoto] = [],
         legend: [Classification]) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.durationSeconds = durationSeconds
        self.distanceMeters = distanceMeters
        self.segments = segments
        self.notes = notes
        self.photos = photos
        self.legend = legend
    }

    /// All route points across all segments, in order.
    var allPoints: [RoutePoint] {
        segments.flatMap { $0.points }
    }

    func classification(for id: String) -> Classification? {
        legend.first { $0.id == id }
    }
}
