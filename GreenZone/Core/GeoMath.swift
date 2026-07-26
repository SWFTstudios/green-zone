import Foundation

/// Pure geographic math. Kept free of UIKit/MapKit so it is easy to unit test.
enum GeoMath {
    static let earthRadiusMeters = 6_371_000.0

    /// Great-circle distance between two points, in meters.
    static func haversineMeters(_ a: RoutePoint, _ b: RoutePoint) -> Double {
        let lat1 = a.lat * .pi / 180
        let lat2 = b.lat * .pi / 180
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLon = (b.lng - a.lng) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusMeters * asin(min(1, sqrt(h)))
    }

    /// Total length of an ordered list of points, in meters.
    static func length(of points: [RoutePoint]) -> Double {
        guard points.count > 1 else { return 0 }
        var total = 0.0
        for i in 1..<points.count {
            total += haversineMeters(points[i - 1], points[i])
        }
        return total
    }

    /// Total distance across all segments. Because adjacent segments share a
    /// boundary point, summing per-segment lengths neither gaps nor double-counts.
    static func distance(of segments: [RouteSegment]) -> Double {
        segments.reduce(0) { $0 + length(of: $1.points) }
    }
}
