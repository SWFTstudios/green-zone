import SwiftUI

/// Editing actions for a single route segment: recolor, split, merge with the
/// next segment, nudge the boundary between it and the next, or delete it.
struct SegmentEditorSheet: View {
    @Environment(\.dismiss) private var dismiss

    let segment: RouteSegment
    let legend: [Classification]
    let hasNext: Bool
    let nextIsSameClassification: Bool
    let onRecolor: (String) -> Void
    let onSplit: () -> Void
    let onMergeNext: () -> Void
    let onMoveBoundary: (Int) -> Void
    let onDelete: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Color") {
                    ForEach(legend) { item in
                        Button {
                            onRecolor(item.id)
                        } label: {
                            HStack {
                                RoundedRectangle(cornerRadius: 5).fill(item.color).frame(width: 22, height: 22)
                                Text(item.label).foregroundStyle(.primary)
                                Spacer()
                                if item.id == segment.classificationId {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                }

                Section("Shape") {
                    Button {
                        onSplit()
                    } label: {
                        Label("Split into two segments", systemImage: "scissors")
                    }
                    .disabled(segment.points.count < 4)

                    if hasNext {
                        Button {
                            onMergeNext()
                        } label: {
                            Label(nextIsSameClassification
                                    ? "Merge with next segment"
                                    : "Merge with next (adopts this color)",
                                  systemImage: "arrow.triangle.merge")
                        }

                        HStack {
                            Text("Adjust boundary with next")
                            Spacer()
                            Button {
                                onMoveBoundary(-1)
                            } label: { Image(systemName: "minus.circle") }
                                .buttonStyle(.borderless)
                            Button {
                                onMoveBoundary(1)
                            } label: { Image(systemName: "plus.circle") }
                                .buttonStyle(.borderless)
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        onDelete()
                    } label: {
                        Label("Delete this segment", systemImage: "trash")
                    }
                } footer: {
                    Text("Splitting divides this segment at its midpoint. Adjust boundary moves where this color ends and the next begins.")
                }
            }
            .navigationTitle("Edit Segment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
