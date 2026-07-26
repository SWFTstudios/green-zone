import XCTest
@testable import GreenZone

final class GeoMathTests: XCTestCase {

    func testHaversineOneDegreeLongitudeAtEquator() {
        let a = RoutePoint(lat: 0, lng: 0)
        let b = RoutePoint(lat: 0, lng: 1)
        // One degree of longitude at the equator on a sphere of radius 6,371,000 m.
        XCTAssertEqual(GeoMath.haversineMeters(a, b), 111_195, accuracy: 100)
    }

    func testHaversineSamePointIsZero() {
        let a = RoutePoint(lat: 37.33, lng: -122.03)
        XCTAssertEqual(GeoMath.haversineMeters(a, a), 0, accuracy: 0.0001)
    }

    func testLengthOfPolyline() {
        let points = [
            RoutePoint(lat: 0, lng: 0),
            RoutePoint(lat: 0, lng: 1),
            RoutePoint(lat: 0, lng: 2)
        ]
        XCTAssertEqual(GeoMath.length(of: points), 222_390, accuracy: 100)
    }

    func testLengthOfSinglePointIsZero() {
        XCTAssertEqual(GeoMath.length(of: [RoutePoint(lat: 1, lng: 1)]), 0)
    }

    func testDistanceAcrossSegmentsDoesNotDoubleCountSharedBoundary() {
        let shared = RoutePoint(lat: 0, lng: 1)
        let segA = RouteSegment(classificationId: "a", points: [RoutePoint(lat: 0, lng: 0), shared])
        let segB = RouteSegment(classificationId: "b", points: [shared, RoutePoint(lat: 0, lng: 2)])
        let combined = GeoMath.distance(of: [segA, segB])
        let straight = GeoMath.length(of: [RoutePoint(lat: 0, lng: 0), RoutePoint(lat: 0, lng: 2)])
        XCTAssertEqual(combined, straight, accuracy: 1)
    }
}
