import SwiftUI

/// Sheet for creating or editing one classification (color + label + meaning).
/// Used both for app-level Pro custom colors and per-trip legend editing.
struct ClassificationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let allowColorEdit: Bool
    @State private var label: String
    @State private var detail: String
    @State private var color: Color
    private let original: Classification
    private let onSave: (Classification) -> Void

    init(classification: Classification,
         title: String = "Edit Color",
         allowColorEdit: Bool = true,
         onSave: @escaping (Classification) -> Void) {
        self.original = classification
        self.title = title
        self.allowColorEdit = allowColorEdit
        self.onSave = onSave
        _label = State(initialValue: classification.label)
        _detail = State(initialValue: classification.detail)
        _color = State(initialValue: Color(hex: classification.colorHex))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Color") {
                    if allowColorEdit {
                        ColorPicker("Color", selection: $color, supportsOpacity: false)
                    } else {
                        HStack {
                            Text("Color")
                            Spacer()
                            RoundedRectangle(cornerRadius: 6).fill(color).frame(width: 28, height: 28)
                        }
                    }
                }
                Section("Label") {
                    TextField("e.g. Purple", text: $label)
                }
                Section("Meaning") {
                    TextField("What this color represents", text: $detail, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var updated = original
                        updated.label = label.trimmingCharacters(in: .whitespacesAndNewlines)
                        updated.detail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
                        if allowColorEdit {
                            updated.colorHex = color.toHexString()
                        }
                        onSave(updated)
                        dismiss()
                    }
                    .disabled(label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
