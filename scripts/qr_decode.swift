// Decodes QR codes with Core Image (macOS), for scripts/check_qrcode.mjs.
// Reads, from the file given as argument, symbols as lines of 0 and 1 separated
// by blank lines; prints one decoded text per symbol (an empty line when none).
import CoreImage
import Foundation

let text = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                          options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for block in text.components(separatedBy: "\n\n") where !block.isEmpty {
    let rows = block.split(separator: "\n").map { Array($0) }
    let scale = 8, quiet = 4
    let n = (rows.count + 2 * quiet) * scale
    var pixels = [UInt8](repeating: 255, count: n * n)
    for (y, row) in rows.enumerated() {
        for (x, c) in row.enumerated() where c == "1" {
            for dy in 0..<scale { for dx in 0..<scale {
                pixels[((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx] = 0
            } }
        }
    }
    let provider = CGDataProvider(data: Data(pixels) as CFData)!
    let image = CGImage(width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: n,
                        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0),
                        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    let found = detector.features(in: CIImage(cgImage: image)) as? [CIQRCodeFeature] ?? []
    print((found.first?.messageString ?? "").replacingOccurrences(of: "\n", with: "\\n"))
}
