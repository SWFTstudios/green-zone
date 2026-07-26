import SwiftUI
import MapKit

/// Renders a route as one colored polyline per segment. Reused by the live
/// recording screen and the read-only trip detail map.
struct RouteMapView: View {
    let segments: [RouteSegment]
    let legend: [Classification]
    var showsUserLocation: Bool = false
    var highlightedSegmentId: UUID? = nil
    @Binding var camera: MapCameraPosition

    var body: some View {
        Map(position: $camera) {
            if showsUserLocation {
                UserAnnotation()
            }
            ForEach(segments) { segment in
                MapPolyline(coordinates: segment.points.map(\.coordinate))
                    .stroke(color(for: segment),
                            style: StrokeStyle(lineWidth: lineWidth(for: segment),
                                               lineCap: .round,
                                               lineJoin: .round))
            }
        }
        .mapControls {
            MapUserLocationButton()
            MapCompass()
        }
    }

    private func color(for segment: RouteSegment) -> Color {
        legend.first { $0.id == segment.classificationId }?.color ?? .gray
    }

    private func lineWidth(for segment: RouteSegment) -> CGFloat {
        segment.id == highlightedSegmentId ? 11 : 6
    }
}
