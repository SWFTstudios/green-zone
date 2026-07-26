import Foundation
import Observation

/// App-wide settings. For the MVP the paid tier is a local toggle; real
/// StoreKit in-app purchases would replace `isPro` later.
@Observable
@MainActor
final class AppSettings {
    var isPro: Bool {
        didSet { UserDefaults.standard.set(isPro, forKey: Keys.isPro) }
    }

    /// Extra classifications a Pro user has created, stored across trips so they
    /// are offered by default when starting a new trip.
    var customClassifications: [Classification] {
        didSet { persistCustom() }
    }

    private enum Keys {
        static let isPro = "settings.isPro"
        static let custom = "settings.customClassifications"
    }

    init() {
        self.isPro = UserDefaults.standard.bool(forKey: Keys.isPro)
        if let data = UserDefaults.standard.data(forKey: Keys.custom),
           let decoded = try? JSONDecoder().decode([Classification].self, from: data) {
            self.customClassifications = decoded
        } else {
            self.customClassifications = []
        }
    }

    private func persistCustom() {
        if let data = try? JSONEncoder().encode(customClassifications) {
            UserDefaults.standard.set(data, forKey: Keys.custom)
        }
    }

    /// The legend a brand-new trip should start with: the standard three colors
    /// plus any custom classifications when Pro is enabled.
    func startingLegend() -> [Classification] {
        var legend = DefaultLegend.standard()
        if isPro {
            legend.append(contentsOf: customClassifications)
        }
        return legend
    }
}
