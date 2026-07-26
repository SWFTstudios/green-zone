import SwiftUI

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var editing: Classification?
    @State private var creatingNew = false

    var body: some View {
        @Bindable var settings = settings

        Form {
            Section {
                Toggle("GreenZone Pro", isOn: $settings.isPro)
            } footer: {
                Text("Pro unlocks custom colors with your own meanings. (For the MVP this is a local toggle; in-app purchase comes later.)")
            }

            Section("Standard legend (free)") {
                LegendView(legend: DefaultLegend.standard())
                    .padding(.vertical, 4)
            }

            Section {
                if settings.isPro {
                    ForEach(settings.customClassifications) { classification in
                        Button {
                            editing = classification
                        } label: {
                            HStack {
                                RoundedRectangle(cornerRadius: 6).fill(classification.color).frame(width: 24, height: 24)
                                VStack(alignment: .leading) {
                                    Text(classification.label).foregroundStyle(.primary)
                                    Text(classification.detail).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .onDelete { offsets in
                        settings.customClassifications.remove(atOffsets: offsets)
                    }

                    Button {
                        creatingNew = true
                    } label: {
                        Label("Add custom color", systemImage: "plus.circle")
                    }
                } else {
                    Label("Enable Pro to add custom colors", systemImage: "lock.fill")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Custom colors (Pro)")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
        .sheet(item: $editing) { classification in
            ClassificationEditorView(classification: classification) { updated in
                if let idx = settings.customClassifications.firstIndex(where: { $0.id == updated.id }) {
                    settings.customClassifications[idx] = updated
                }
            }
        }
        .sheet(isPresented: $creatingNew) {
            ClassificationEditorView(
                classification: Classification(colorHex: "#8E44AD", label: "", detail: ""),
                title: "New Color"
            ) { created in
                settings.customClassifications.append(created)
            }
        }
    }
}
