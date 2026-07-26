import SwiftUI

/// Read-only legend explaining what each color means.
struct LegendView: View {
    let legend: [Classification]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(legend) { item in
                HStack(alignment: .top, spacing: 12) {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(item.color)
                        .frame(width: 26, height: 26)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.label)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        Text(item.detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
