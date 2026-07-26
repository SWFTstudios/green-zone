import SwiftUI

/// The large, tappable classification buttons used while recording. The active
/// classification is emphasized so the driver can glance-confirm the color.
struct ColorButtonBar: View {
    let classifications: [Classification]
    let activeId: String
    let onSelect: (String) -> Void

    private var columns: [GridItem] {
        let count = min(3, max(1, classifications.count))
        return Array(repeating: GridItem(.flexible(), spacing: 10), count: count)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(classifications) { classification in
                Button {
                    onSelect(classification.id)
                } label: {
                    Text(classification.label)
                        .font(.headline)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .foregroundStyle(.white)
                        .background(classification.color)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(.white, lineWidth: classification.id == activeId ? 4 : 0)
                        )
                        .shadow(radius: classification.id == activeId ? 6 : 0)
                        .scaleEffect(classification.id == activeId ? 1.0 : 0.94)
                        .opacity(classification.id == activeId ? 1.0 : 0.85)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(classification.label))
                .accessibilityAddTraits(classification.id == activeId ? [.isSelected] : [])
            }
        }
        .animation(.easeInOut(duration: 0.15), value: activeId)
    }
}
