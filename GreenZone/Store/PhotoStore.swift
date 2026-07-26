import UIKit

/// Stores trip photos as JPEG files in Documents/photos and returns file names
/// that are persisted on the `TripPhoto` model.
final class PhotoStore {
    static let shared = PhotoStore()

    private var directory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("photos", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private func url(for fileName: String) -> URL {
        directory.appendingPathComponent(fileName)
    }

    /// Save an image, returning the generated file name (or nil on failure).
    @discardableResult
    func save(_ image: UIImage) -> String? {
        guard let data = image.jpegData(compressionQuality: 0.8) else { return nil }
        let name = "\(UUID().uuidString).jpg"
        do {
            try data.write(to: url(for: name), options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    func load(fileName: String) -> UIImage? {
        guard let data = try? Data(contentsOf: url(for: fileName)) else { return nil }
        return UIImage(data: data)
    }

    func delete(fileName: String) {
        try? FileManager.default.removeItem(at: url(for: fileName))
    }
}
