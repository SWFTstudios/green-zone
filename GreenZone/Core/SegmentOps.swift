import Foundation

/// Pure, value-semantic operations on a list of route segments.
///
/// Invariant maintained throughout: two adjacent segments share a boundary
/// point, i.e. `segments[i].points.last == segments[i+1].points.first`. This
/// keeps the drawn polyline continuous across color changes.
enum SegmentOps {

    /// Append a live GPS point while recording, using the currently active
    /// classification. Extends the current segment when the color is unchanged,
    /// otherwise starts a new segment seeded with the previous boundary point.
    static func appendPoint(_ segments: [RouteSegment],
                            point: RoutePoint,
                            classificationId: String,
                            makeId: () -> UUID = { UUID() }) -> [RouteSegment] {
        var segments = segments

        if var last = segments.last, last.classificationId == classificationId {
            last.points.append(point)
            segments[segments.count - 1] = last
            return segments
        }

        var newPoints: [RoutePoint] = []
        if let boundary = segments.last?.points.last {
            newPoints.append(boundary)
        }
        newPoints.append(point)
        segments.append(RouteSegment(id: makeId(), classificationId: classificationId, points: newPoints))
        return segments
    }

    /// Change the classification of one segment.
    static func recolor(_ segments: [RouteSegment],
                        segmentId: UUID,
                        to classificationId: String) -> [RouteSegment] {
        segments.map { seg in
            guard seg.id == segmentId else { return seg }
            return RouteSegment(id: seg.id, classificationId: classificationId, points: seg.points)
        }
    }

    /// Split a segment into two at the given point index. The point at `index`
    /// is shared by both halves (it becomes the new boundary point). Requires at
    /// least two points on each side, otherwise the list is returned unchanged.
    static func split(_ segments: [RouteSegment],
                      segmentId: UUID,
                      atPointIndex index: Int,
                      makeId: () -> UUID = { UUID() }) -> [RouteSegment] {
        guard let i = segments.firstIndex(where: { $0.id == segmentId }) else { return segments }
        let seg = segments[i]
        guard index > 0, index < seg.points.count - 1 else { return segments }

        var segments = segments
        let first = Array(seg.points[0...index])
        let second = Array(seg.points[index...])
        segments[i] = RouteSegment(id: seg.id, classificationId: seg.classificationId, points: first)
        segments.insert(RouteSegment(id: makeId(), classificationId: seg.classificationId, points: second), at: i + 1)
        return segments
    }

    /// Merge a segment with the segment immediately after it. Used to merge
    /// neighbors that share a classification; the result keeps the first
    /// segment's classification and id.
    static func mergeWithNext(_ segments: [RouteSegment], segmentId: UUID) -> [RouteSegment] {
        guard let i = segments.firstIndex(where: { $0.id == segmentId }), i < segments.count - 1 else {
            return segments
        }
        var segments = segments
        let a = segments[i]
        let b = segments[i + 1]

        var merged = a.points
        var tail = b.points
        if let last = a.points.last, let first = b.points.first, last == first {
            tail.removeFirst()
        }
        merged.append(contentsOf: tail)

        segments[i] = RouteSegment(id: a.id, classificationId: a.classificationId, points: merged)
        segments.remove(at: i + 1)
        return segments
    }

    /// Collapse every run of consecutive segments that share a classification.
    static func mergeAllSameClassification(_ segments: [RouteSegment]) -> [RouteSegment] {
        var result: [RouteSegment] = []
        for seg in segments {
            if var last = result.last, last.classificationId == seg.classificationId {
                var tail = seg.points
                if let l = last.points.last, let f = seg.points.first, l == f {
                    tail.removeFirst()
                }
                last.points.append(contentsOf: tail)
                result[result.count - 1] = last
            } else {
                result.append(seg)
            }
        }
        return result
    }

    /// Move the boundary between a segment and the next one by `delta` points.
    /// Positive `delta` grows this segment (takes points from the next);
    /// negative shrinks it (gives points to the next). Each side always keeps at
    /// least two points.
    static func moveBoundary(_ segments: [RouteSegment], segmentId: UUID, by delta: Int) -> [RouteSegment] {
        guard delta != 0,
              let i = segments.firstIndex(where: { $0.id == segmentId }),
              i < segments.count - 1 else { return segments }

        var segments = segments
        var a = segments[i]
        var b = segments[i + 1]

        if delta > 0 {
            for _ in 0..<delta {
                guard b.points.count > 2 else { break }
                let moved = b.points[1]
                a.points.append(moved)
                b.points.removeFirst()
            }
        } else {
            for _ in 0..<(-delta) {
                guard a.points.count > 2 else { break }
                let moved = a.points[a.points.count - 2]
                b.points.insert(moved, at: 0)
                a.points.removeLast()
            }
        }

        segments[i] = a
        segments[i + 1] = b
        return segments
    }

    /// Remove a segment entirely (e.g. an accidental detour). Neighbors are not
    /// stitched back together, matching the "delete incorrect route sections" use case.
    static func delete(_ segments: [RouteSegment], segmentId: UUID) -> [RouteSegment] {
        segments.filter { $0.id != segmentId }
    }
}
