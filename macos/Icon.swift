import Cocoa

// Code-drawn timeline icon; no external artwork or fonts.
let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(size)/1024, y: CGFloat(size)/1024)
    NSColor(calibratedRed: 0.10, green: 0.24, blue: 0.21, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 205, yRadius: 205).fill()
    NSColor(calibratedWhite: 1, alpha: 0.14).setStroke()
    for x in stride(from: 260, through: 780, by: 130) {
        let line = NSBezierPath(); line.lineWidth = 8
        line.move(to: NSPoint(x: CGFloat(x), y: 245)); line.line(to: NSPoint(x: CGFloat(x), y: 785)); line.stroke()
    }
    let bars: [(CGFloat, CGFloat, CGFloat, NSColor)] = [
        (220, 650, 360, NSColor(calibratedRed: 0.61, green: 0.77, blue: 0.90, alpha: 1)),
        (400, 460, 400, NSColor(calibratedRed: 0.72, green: 0.85, blue: 0.65, alpha: 1)),
        (650, 270, 150, NSColor(calibratedRed: 0.94, green: 0.78, blue: 0.50, alpha: 1))]
    for (x, y, width, color) in bars {
        color.setFill(); NSBezierPath(roundedRect: NSRect(x: x, y: y, width: width, height: 105), xRadius: 30, yRadius: 30).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    let data = rep.representation(using: .png, properties: [:])!
    if size <= 512 { try data.write(to: folder.appendingPathComponent("icon_\(size)x\(size).png")) }
    if size >= 32 { try data.write(to: folder.appendingPathComponent("icon_\(size/2)x\(size/2)@2x.png")) }
}
