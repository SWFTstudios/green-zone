import SwiftUI
import MapKit
import PhotosUI
import UIKit

/// The editable Trip Detail screen: review the route and clean it up afterward.
struct TripDetailContent: View {
    @Environment(AppSettings.self) private var settings

    @Binding var trip: Trip
    let commit: () -> Void

    @State private var camera: MapCameraPosition = .automatic
    @State private var selectedSegmentId: UUID?
    @State private var editingSegment: RouteSegment?
    @State private var editingLegendItem: Classification?
    @State private var addingLegendItem = false
    @State private var renaming = false
    @State private var nameDraft = ""
    @State private var addingNote = false
    @State private var noteDraft = ""
    @State private var editingNote: TripNote?
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        List {
            mapSection
            overviewSection
            segmentsSection
            notesSection
            photosSection
            legendSection
        }
        .listStyle(.insetGrouped)
        .navigationTitle(trip.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    nameDraft = trip.name
                    renaming = true
                } label: {
                    Image(systemName: "pencil")
                }
            }
        }
        .alert("Rename Trip", isPresented: $renaming) {
            TextField("Name", text: $nameDraft)
            Button("Save") {
                let trimmed = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { trip.name = trimmed; commit() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $editingSegment) { segment in
            segmentEditorSheet(for: segment)
        }
        .sheet(item: $editingLegendItem) { item in
            ClassificationEditorView(classification: item,
                                     allowColorEdit: settings.isPro || !item.builtin) { updated in
                if let idx = trip.legend.firstIndex(where: { $0.id == updated.id }) {
                    trip.legend[idx] = updated
                    commit()
                }
            }
        }
        .sheet(isPresented: $addingLegendItem) {
            ClassificationEditorView(
                classification: Classification(colorHex: "#8E44AD", label: "", detail: ""),
                title: "New Color"
            ) { created in
                trip.legend.append(created)
                commit()
            }
        }
    }

    // MARK: - Map

    private var mapSection: some View {
        Section {
            RouteMapView(segments: trip.segments,
                         legend: trip.legend,
                         highlightedSegmentId: selectedSegmentId,
                         camera: $camera)
                .frame(height: 260)
                .listRowInsets(EdgeInsets())
        }
    }

    // MARK: - Overview

    private var overviewSection: some View {
        Section("Overview") {
            LabeledContent("Date", value: Format.dateTime(trip.createdAt))
            LabeledContent("Duration", value: Format.duration(trip.durationSeconds))
            LabeledContent("Distance", value: Format.distance(trip.distanceMeters))
        }
    }

    // MARK: - Segments

    private var segmentsSection: some View {
        Section("Route segments") {
            if trip.segments.isEmpty {
                Text("No route recorded.").foregroundStyle(.secondary)
            }
            ForEach(trip.segments) { segment in
                Button {
                    selectedSegmentId = segment.id
                    editingSegment = segment
                } label: {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(color(for: segment))
                            .frame(width: 22, height: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label(for: segment)).foregroundStyle(.primary)
                            Text(Format.distance(GeoMath.length(of: segment.points)))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "slider.horizontal.3").foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button(role: .destructive) {
                        deleteSegment(segment.id)
                    } label: { Label("Delete", systemImage: "trash") }
                }
            }
            if trip.segments.count > 1 {
                Button {
                    trip.segments = SegmentOps.mergeAllSameClassification(trip.segments)
                    commit()
                } label: {
                    Label("Merge all same-color neighbors", systemImage: "arrow.triangle.merge")
                }
            }
        }
    }

    // MARK: - Notes

    private var notesSection: some View {
        Section("Notes") {
            ForEach(trip.notes) { note in
                Button {
                    editingNote = note
                    noteDraft = note.text
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(note.text).foregroundStyle(.primary)
                        Text(Format.dateTime(note.at)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button(role: .destructive) {
                        trip.notes.removeAll { $0.id == note.id }
                        commit()
                    } label: { Label("Delete", systemImage: "trash") }
                }
            }
            Button {
                noteDraft = ""
                addingNote = true
            } label: {
                Label("Add note", systemImage: "note.text.badge.plus")
            }
        }
        .alert("Add Note", isPresented: $addingNote) {
            TextField("Observation", text: $noteDraft)
            Button("Save") {
                let trimmed = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { trip.notes.append(TripNote(text: trimmed)); commit() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Edit Note", isPresented: Binding(get: { editingNote != nil },
                                                 set: { if !$0 { editingNote = nil } })) {
            TextField("Observation", text: $noteDraft)
            Button("Save") {
                if let editingNote, let idx = trip.notes.firstIndex(where: { $0.id == editingNote.id }) {
                    trip.notes[idx].text = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    commit()
                }
                editingNote = nil
            }
            Button("Cancel", role: .cancel) { editingNote = nil }
        }
    }

    // MARK: - Photos

    private var photosSection: some View {
        Section("Photos") {
            if !trip.photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(trip.photos) { photo in
                            PhotoThumbView(photo: photo) {
                                deletePhoto(photo)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Add photo", systemImage: "photo.badge.plus")
            }
            .onChange(of: photoItem) { _, newItem in
                importPhoto(newItem)
            }
        }
    }

    // MARK: - Legend

    private var legendSection: some View {
        Section {
            ForEach(trip.legend) { item in
                Button {
                    editingLegendItem = item
                } label: {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 5).fill(item.color).frame(width: 22, height: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label).foregroundStyle(.primary)
                            Text(item.detail).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !item.builtin {
                            Text("Custom").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .swipeActions {
                    if !item.builtin {
                        Button(role: .destructive) {
                            removeLegendItem(item)
                        } label: { Label("Remove", systemImage: "trash") }
                    }
                }
            }
            if settings.isPro {
                Button {
                    addingLegendItem = true
                } label: {
                    Label("Add custom color", systemImage: "plus.circle")
                }
            }
        } header: {
            Text("Legend")
        } footer: {
            if !settings.isPro {
                Text("Enable GreenZone Pro in Settings to add custom colors to this trip.")
            }
        }
    }

    // MARK: - Segment editor sheet

    private func segmentEditorSheet(for segment: RouteSegment) -> some View {
        let index = trip.segments.firstIndex(where: { $0.id == segment.id })
        let hasNext = (index.map { $0 < trip.segments.count - 1 }) ?? false
        let nextSameClass = hasNext && index != nil
            && trip.segments[index! + 1].classificationId == segment.classificationId
        return SegmentEditorSheet(
            segment: segment,
            legend: trip.legend,
            hasNext: hasNext,
            nextIsSameClassification: nextSameClass,
            onRecolor: { recolor(segment.id, to: $0) },
            onSplit: { split(segment.id) },
            onMergeNext: { mergeNext(segment.id) },
            onMoveBoundary: { moveBoundary(segment.id, by: $0) },
            onDelete: { deleteSegment(segment.id) }
        )
    }

    // MARK: - Helpers

    private func color(for segment: RouteSegment) -> Color {
        trip.classification(for: segment.classificationId)?.color ?? .gray
    }

    private func label(for segment: RouteSegment) -> String {
        trip.classification(for: segment.classificationId)?.label ?? "Unknown"
    }

    private func recolor(_ id: UUID, to classificationId: String) {
        trip.segments = SegmentOps.recolor(trip.segments, segmentId: id, to: classificationId)
        commit()
    }

    private func split(_ id: UUID) {
        guard let seg = trip.segments.first(where: { $0.id == id }) else { return }
        let mid = seg.points.count / 2
        trip.segments = SegmentOps.split(trip.segments, segmentId: id, atPointIndex: mid)
        commit()
        editingSegment = nil
    }

    private func mergeNext(_ id: UUID) {
        trip.segments = SegmentOps.mergeWithNext(trip.segments, segmentId: id)
        commit()
        editingSegment = nil
    }

    private func moveBoundary(_ id: UUID, by delta: Int) {
        trip.segments = SegmentOps.moveBoundary(trip.segments, segmentId: id, by: delta)
        commit()
        if let updated = trip.segments.first(where: { $0.id == id }) {
            editingSegment = updated
        }
    }

    private func deleteSegment(_ id: UUID) {
        trip.segments = SegmentOps.delete(trip.segments, segmentId: id)
        commit()
        editingSegment = nil
        if selectedSegmentId == id { selectedSegmentId = nil }
    }

    private func deletePhoto(_ photo: TripPhoto) {
        PhotoStore.shared.delete(fileName: photo.fileName)
        trip.photos.removeAll { $0.id == photo.id }
        commit()
    }

    private func importPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task { @MainActor in
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data),
               let name = PhotoStore.shared.save(image) {
                trip.photos.append(TripPhoto(fileName: name))
                commit()
            }
            photoItem = nil
        }
    }

    private func removeLegendItem(_ item: Classification) {
        // Fall back any segments using this classification to green so the map stays valid.
        trip.segments = trip.segments.map { seg in
            seg.classificationId == item.id
                ? RouteSegment(id: seg.id, classificationId: DefaultLegend.greenId, points: seg.points)
                : seg
        }
        trip.legend.removeAll { $0.id == item.id }
        commit()
    }
}

/// A photo thumbnail with a delete affordance.
private struct PhotoThumbView: View {
    let photo: TripPhoto
    let onDelete: () -> Void
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Color.secondary.opacity(0.2)
                }
            }
            .frame(width: 90, height: 90)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            Button(action: onDelete) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .padding(4)
        }
        .task {
            image = PhotoStore.shared.load(fileName: photo.fileName)
        }
    }
}
