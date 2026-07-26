import XCTest
@testable import GreenZone

final class SegmentOpsTests: XCTestCase {

    private func p(_ lng: Double) -> RoutePoint {
        RoutePoint(lat: 0, lng: lng, t: Date(timeIntervalSince1970: lng))
    }

    // MARK: - appendPoint

    func testAppendFirstPointCreatesSegment() {
        let result = SegmentOps.appendPoint([], point: p(0), classificationId: "green")
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].classificationId, "green")
        XCTAssertEqual(result[0].points, [p(0)])
    }

    func testAppendSameClassificationExtendsSegment() {
        var segs = SegmentOps.appendPoint([], point: p(0), classificationId: "green")
        segs = SegmentOps.appendPoint(segs, point: p(1), classificationId: "green")
        XCTAssertEqual(segs.count, 1)
        XCTAssertEqual(segs[0].points, [p(0), p(1)])
    }

    func testSwitchingClassificationStartsNewSegmentSeededWithBoundary() {
        var segs = SegmentOps.appendPoint([], point: p(0), classificationId: "green")
        segs = SegmentOps.appendPoint(segs, point: p(1), classificationId: "green")
        segs = SegmentOps.appendPoint(segs, point: p(2), classificationId: "red")

        XCTAssertEqual(segs.count, 2)
        // New segment starts at the previous segment's last point (continuity).
        XCTAssertEqual(segs[1].classificationId, "red")
        XCTAssertEqual(segs[1].points, [p(1), p(2)])
        XCTAssertEqual(segs[0].points.last, segs[1].points.first)
    }

    // MARK: - recolor

    func testRecolor() {
        let seg = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let result = SegmentOps.recolor([seg], segmentId: seg.id, to: "red")
        XCTAssertEqual(result[0].classificationId, "red")
        XCTAssertEqual(result[0].id, seg.id)
    }

    // MARK: - split

    func testSplitAtMidpointSharesBoundary() {
        let seg = RouteSegment(classificationId: "green", points: [p(0), p(1), p(2), p(3)])
        let result = SegmentOps.split([seg], segmentId: seg.id, atPointIndex: 2)
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].points, [p(0), p(1), p(2)])
        XCTAssertEqual(result[1].points, [p(2), p(3)])
        XCTAssertEqual(result[0].points.last, result[1].points.first)
        XCTAssertEqual(result[0].id, seg.id)
    }

    func testSplitRejectsOutOfRangeIndex() {
        let seg = RouteSegment(classificationId: "green", points: [p(0), p(1), p(2)])
        XCTAssertEqual(SegmentOps.split([seg], segmentId: seg.id, atPointIndex: 0).count, 1)
        XCTAssertEqual(SegmentOps.split([seg], segmentId: seg.id, atPointIndex: 2).count, 1)
    }

    // MARK: - merge

    func testMergeWithNextDropsDuplicateBoundary() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let b = RouteSegment(classificationId: "green", points: [p(1), p(2)])
        let result = SegmentOps.mergeWithNext([a, b], segmentId: a.id)
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].points, [p(0), p(1), p(2)])
        XCTAssertEqual(result[0].id, a.id)
    }

    func testMergeAllSameClassificationCollapsesRuns() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let b = RouteSegment(classificationId: "green", points: [p(1), p(2)])
        let c = RouteSegment(classificationId: "red", points: [p(2), p(3)])
        let d = RouteSegment(classificationId: "red", points: [p(3), p(4)])
        let result = SegmentOps.mergeAllSameClassification([a, b, c, d])
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].classificationId, "green")
        XCTAssertEqual(result[0].points, [p(0), p(1), p(2)])
        XCTAssertEqual(result[1].classificationId, "red")
        XCTAssertEqual(result[1].points, [p(2), p(3), p(4)])
    }

    // MARK: - moveBoundary

    func testMoveBoundaryForwardGrowsFirstSegment() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let b = RouteSegment(classificationId: "red", points: [p(1), p(2), p(3)])
        let result = SegmentOps.moveBoundary([a, b], segmentId: a.id, by: 1)
        XCTAssertEqual(result[0].points, [p(0), p(1), p(2)])
        XCTAssertEqual(result[1].points, [p(2), p(3)])
        XCTAssertEqual(result[0].points.last, result[1].points.first)
    }

    func testMoveBoundaryBackwardGrowsSecondSegment() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1), p(2)])
        let b = RouteSegment(classificationId: "red", points: [p(2), p(3)])
        let result = SegmentOps.moveBoundary([a, b], segmentId: a.id, by: -1)
        XCTAssertEqual(result[0].points, [p(0), p(1)])
        XCTAssertEqual(result[1].points, [p(1), p(2), p(3)])
        XCTAssertEqual(result[0].points.last, result[1].points.first)
    }

    func testMoveBoundaryKeepsAtLeastTwoPointsPerSide() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let b = RouteSegment(classificationId: "red", points: [p(1), p(2)])
        // Cannot move: the next segment would drop below two points.
        let result = SegmentOps.moveBoundary([a, b], segmentId: a.id, by: 1)
        XCTAssertEqual(result[0].points, [p(0), p(1)])
        XCTAssertEqual(result[1].points, [p(1), p(2)])
    }

    // MARK: - delete

    func testDeleteRemovesSegment() {
        let a = RouteSegment(classificationId: "green", points: [p(0), p(1)])
        let b = RouteSegment(classificationId: "red", points: [p(1), p(2)])
        let result = SegmentOps.delete([a, b], segmentId: a.id)
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].id, b.id)
    }
}
