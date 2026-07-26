import Foundation

/// The built-in real-estate legend used by the free version.
enum DefaultLegend {
    static let greenId = "builtin.green"
    static let yellowId = "builtin.yellow"
    static let redId = "builtin.red"

    static let green = Classification(
        id: greenId,
        colorHex: "#2E9E4F",
        label: "Green",
        detail: "Desirable neighborhood where you feel safe walking, investing, or bringing clients.",
        builtin: true
    )

    static let yellow = Classification(
        id: yellowId,
        colorHex: "#F2C037",
        label: "Yellow",
        detail: "Average or transitional neighborhood that may require more research.",
        builtin: true
    )

    static let red = Classification(
        id: redId,
        colorHex: "#E23B3B",
        label: "Red",
        detail: "Undesirable or poorly maintained neighborhood where you may not feel comfortable walking, investing, or bringing family.",
        builtin: true
    )

    /// A fresh copy of the standard three-color legend.
    static func standard() -> [Classification] {
        [green, yellow, red]
    }

    /// Example custom classifications a Pro user might add.
    static func proExamples() -> [Classification] {
        [
            Classification(colorHex: "#8E44AD", label: "Purple", detail: "Ideal customer demographic."),
            Classification(colorHex: "#2E77D0", label: "Blue", detail: "Already canvassed."),
            Classification(colorHex: "#E67E22", label: "Orange", detail: "Needs a second visit."),
            Classification(colorHex: "#E84393", label: "Pink", detail: "Strong rental potential.")
        ]
    }
}
