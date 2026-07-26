import SwiftUI
import MapKit
import CoreLocation

/// Full-screen live recording experience: map with the painted route, a HUD for
/// duration/distance, the large color buttons, and Start/End controls.
struct RecordTripView: View {
    @State private var recorder: TripRecorder
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var showEndConfirm = false
    @State private var showNoteSheet = false
    @State private var noteText = ""

    private let onFinish: (Trip?) -> Void

    init(legend: [Classification], onFinish: @escaping (Trip?) -> Void) {
        _recorder = State(initialValue: TripRecorder(legend: legend))
        self.onFinish = onFinish
    }

    var body: some View {
        ZStack {
            RouteMapView(segments: recorder.segments,
                         legend: recorder.legend,
                         showsUserLocation: true,
                         camera: $camera)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                hud
                Spacer()
                controls
            }
        }
        .onAppear {
            recorder.requestAuthorization()
            recorder.start(name: "")
        }
        .sheet(isPresented: $showNoteSheet) { noteSheet }
        .confirmationDialog("End this trip?", isPresented: $showEndConfirm, titleVisibility: .visible) {
            Button("End Trip", role: .destructive) { endTrip() }
            Button("Keep Recording", role: .cancel) {}
        } message: {
            Text("Your route and notes will be saved.")
        }
        .interactiveDismissDisabled(true)
    }

    // MARK: - HUD

    private var hud: some View {
        VStack(spacing: 8) {
            HStack {
                Label(Format.duration(recorder.elapsedSeconds), systemImage: "clock")
                Spacer()
                Label(Format.distance(recorder.distanceMeters), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                Spacer()
                Button(role: .destructive) {
                    showEndConfirm = true
                } label: {
                    Text("End")
                        .fontWeight(.bold)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(.red, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            .font(.subheadline.weight(.semibold))

            if recorder.authorizationStatus == .authorizedWhenInUse {
                backgroundUpsell
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private var backgroundUpsell: some View {
        Button {
            recorder.requestAlwaysAuthorization()
        } label: {
            Label("Enable background tracking (Always) to keep painting with the screen off",
                  systemImage: "location.fill")
                .font(.caption)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tint(.blue)
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Painting as")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(recorder.activeClassification?.label ?? "-")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(recorder.activeClassification?.color ?? .primary)
                Spacer()
                Button {
                    noteText = ""
                    showNoteSheet = true
                } label: {
                    Label("Note", systemImage: "note.text.badge.plus")
                }
                .font(.subheadline.weight(.semibold))
            }

            ColorButtonBar(classifications: recorder.legend,
                           activeId: recorder.activeClassificationId,
                           onSelect: recorder.selectClassification)
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    // MARK: - Note sheet

    private var noteSheet: some View {
        NavigationStack {
            Form {
                Section("Observation") {
                    TextField("What did you notice?", text: $noteText, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Add Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showNoteSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        recorder.addNote(noteText)
                        showNoteSheet = false
                    }
                    .disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func endTrip() {
        let trip = recorder.finish()
        onFinish(trip)
    }
}
