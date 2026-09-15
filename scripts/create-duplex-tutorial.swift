import AppKit
import AVFoundation
import CoreVideo

let width = 1280
let height = 720
let fps: Int32 = 30
let duration = 36.0
let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "docs/assets/duplex-printing-guide.mp4")

let burgundy = NSColor(calibratedRed: 0.43, green: 0.08, blue: 0.15, alpha: 1)
let cream = NSColor(calibratedRed: 0.97, green: 0.95, blue: 0.89, alpha: 1)
let ink = NSColor(calibratedWhite: 0.12, alpha: 1)
let muted = NSColor(calibratedWhite: 0.40, alpha: 1)
let green = NSColor(calibratedRed: 0.13, green: 0.48, blue: 0.31, alpha: 1)

func ease(_ x: Double) -> CGFloat {
    let v = max(0, min(1, x))
    return CGFloat(v * v * (3 - 2 * v))
}

func local(_ t: Double, _ start: Double, _ end: Double) -> CGFloat { ease((t - start) / (end - start)) }

func text(_ value: String, _ rect: CGRect, size: CGFloat, color: NSColor = ink,
          weight: NSFont.Weight = .regular, alignment: NSTextAlignment = .left) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    style.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style
    ]
    NSString(string: value).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attrs)
}

func rounded(_ rect: CGRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil, line: CGFloat = 1) {
    let p = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill(); p.fill()
    if let stroke { stroke.setStroke(); p.lineWidth = line; p.stroke() }
}

func paper(_ rect: CGRect, page: String, back: Bool = false) {
    NSGraphicsContext.current?.cgContext.saveGState()
    NSGraphicsContext.current?.cgContext.setShadow(offset: CGSize(width: 0, height: -8), blur: 12, color: NSColor.black.withAlphaComponent(0.15).cgColor)
    rounded(rect, radius: 8, fill: .white, stroke: NSColor(calibratedWhite: 0.82, alpha: 1))
    NSGraphicsContext.current?.cgContext.restoreGState()
    text(back ? "BACK" : "PAGE", CGRect(x: rect.minX + 22, y: rect.maxY - 58, width: rect.width - 44, height: 24), size: 13, color: muted, weight: .semibold)
    text(page, CGRect(x: rect.minX + 22, y: rect.midY - 34, width: rect.width - 44, height: 68), size: 48, color: burgundy, weight: .bold, alignment: .center)
    for i in 0..<4 {
        let y = rect.minY + 34 + CGFloat(i) * 18
        NSColor(calibratedWhite: 0.87, alpha: 1).setFill()
        NSBezierPath(roundedRect: CGRect(x: rect.minX + 25, y: y, width: rect.width - 50 - CGFloat(i % 2) * 28, height: 5), xRadius: 2.5, yRadius: 2.5).fill()
    }
}

func printer(_ origin: CGPoint, progress: CGFloat = 0) {
    rounded(CGRect(x: origin.x, y: origin.y, width: 300, height: 190), radius: 22, fill: NSColor(calibratedWhite: 0.20, alpha: 1))
    rounded(CGRect(x: origin.x + 30, y: origin.y + 102, width: 240, height: 58), radius: 8, fill: NSColor(calibratedWhite: 0.12, alpha: 1))
    rounded(CGRect(x: origin.x + 62, y: origin.y + 22, width: 176, height: 110), radius: 4, fill: .white)
    burgundy.setFill(); NSBezierPath(ovalIn: CGRect(x: origin.x + 250, y: origin.y + 165, width: 12, height: 12)).fill()
    if progress > 0 {
        green.setFill()
        NSBezierPath(roundedRect: CGRect(x: origin.x + 30, y: origin.y - 18, width: 240 * progress, height: 7), xRadius: 3.5, yRadius: 3.5).fill()
    }
}

func header(step: String, title: String, subtitle: String) {
    text(step.uppercased(), CGRect(x: 72, y: 630, width: 1136, height: 24), size: 14, color: burgundy, weight: .bold)
    text(title, CGRect(x: 72, y: 552, width: 1136, height: 70), size: 44, weight: .bold)
    text(subtitle, CGRect(x: 72, y: 505, width: 1136, height: 42), size: 23, color: muted)
}

func stepDots(_ active: Int) {
    for i in 0..<6 {
        let c = i < active ? green : i == active ? burgundy : NSColor(calibratedWhite: 0.80, alpha: 1)
        c.setFill(); NSBezierPath(ovalIn: CGRect(x: 72 + CGFloat(i) * 30, y: 52, width: 12, height: 12)).fill()
    }
}

func drawFrame(t: Double, context: CGContext) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    cream.setFill(); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    burgundy.setFill(); context.fill(CGRect(x: 0, y: 686, width: width, height: 34))
    text("THE PAPER CLUB  /  PRINT-MS", CGRect(x: 72, y: 692, width: 500, height: 18), size: 12, color: .white, weight: .bold)

    if t < 4 {
        let a = local(t, 0.3, 1.3)
        context.saveGState(); context.setAlpha(a)
        text("HOW TO PRINT", CGRect(x: 72, y: 430, width: 1136, height: 45), size: 22, color: burgundy, weight: .bold, alignment: .center)
        text("Back-to-back", CGRect(x: 72, y: 320, width: 1136, height: 105), size: 72, weight: .bold, alignment: .center)
        text("A simple guide for multi-page documents", CGRect(x: 72, y: 270, width: 1136, height: 40), size: 25, color: muted, alignment: .center)
        context.restoreGState()
        let x = 490 + 24 * sin(CGFloat(t) * 2)
        paper(CGRect(x: x, y: 88, width: 145, height: 160), page: "1")
        paper(CGRect(x: x + 155, y: 88, width: 145, height: 160), page: "2", back: true)
    } else if t < 9 {
        header(step: "Step 1 of 6", title: "Choose Back-to-back", subtitle: "Create the job with one ordered, multi-page document.")
        stepDots(0)
        rounded(CGRect(x: 250, y: 170, width: 780, height: 270), radius: 18, fill: .white, stroke: NSColor(calibratedWhite: 0.82, alpha: 1))
        text("Variant", CGRect(x: 300, y: 375, width: 200, height: 30), size: 18, color: muted, weight: .semibold)
        rounded(CGRect(x: 300, y: 290, width: 680, height: 72), radius: 10, fill: cream, stroke: burgundy, line: 2)
        text("Back-to-back  ·  supervised duplex", CGRect(x: 325, y: 310, width: 600, height: 32), size: 23, weight: .semibold)
        let check = local(t, 5.3, 6.2)
        if check > 0.2 { text("✓", CGRect(x: 908, y: 302, width: 45, height: 45), size: 31, color: green, weight: .bold, alignment: .center) }
        text("Pages are paired: 1–2, 3–4, 5–6…", CGRect(x: 300, y: 220, width: 680, height: 38), size: 21, color: muted, alignment: .center)
    } else if t < 14 {
        header(step: "Step 2 of 6", title: "Print the front sides", subtitle: "Select the printer and click “Print front sides.”")
        stepDots(1)
        printer(CGPoint(x: 490, y: 185), progress: local(t, 10, 13))
        let p = local(t, 10, 12.7)
        paper(CGRect(x: 550, y: 325 + 95 * p, width: 180, height: 200), page: "1")
        text("Print-MS sends pages 1, 3, 5…", CGRect(x: 350, y: 110, width: 580, height: 34), size: 22, color: muted, alignment: .center)
    } else if t < 19 {
        header(step: "Step 3 of 6", title: "Wait for every sheet", subtitle: "Collect the complete output stack. Keep its order intact.")
        stepDots(2)
        for i in 0..<4 {
            paper(CGRect(x: 480 + CGFloat(i) * 18, y: 150 + CGFloat(i) * 20, width: 230, height: 270), page: String(i * 2 + 1))
        }
        text("DO NOT SHUFFLE", CGRect(x: 810, y: 270, width: 300, height: 35), size: 22, color: burgundy, weight: .bold)
        text("Keep the sheets exactly as they leave the printer.", CGRect(x: 810, y: 205, width: 300, height: 58), size: 20, color: muted)
    } else if t < 24 {
        header(step: "Step 4 of 6", title: "Rotate the whole stack 180°", subtitle: "Turn it end-for-end—do not reverse individual sheets.")
        stepDots(3)
        let angle = CGFloat.pi * local(t, 20, 22.5)
        context.saveGState(); context.translateBy(x: 640, y: 285); context.rotate(by: angle)
        paper(CGRect(x: -125, y: -150, width: 250, height: 300), page: "STACK")
        context.restoreGState()
        text("↻", CGRect(x: 790, y: 245, width: 100, height: 100), size: 70, color: burgundy, weight: .bold, alignment: .center)
    } else if t < 29 {
        header(step: "Step 5 of 6", title: "Reload printed side down", subtitle: "Use the Canon rear tray and align both paper guides.")
        stepDots(4)
        printer(CGPoint(x: 490, y: 150))
        let p = local(t, 25, 27.8)
        context.saveGState(); context.translateBy(x: 640, y: 470 - 160 * p); context.rotate(by: .pi)
        paper(CGRect(x: -90, y: -100, width: 180, height: 200), page: "↓")
        context.restoreGState()
        text("PRINTED SIDE DOWN", CGRect(x: 820, y: 300, width: 330, height: 36), size: 22, color: burgundy, weight: .bold)
        text("Confirm the paper setting on the printer.", CGRect(x: 820, y: 240, width: 330, height: 54), size: 20, color: muted)
    } else if t < 34 {
        header(step: "Step 6 of 6", title: "Print the back sides", subtitle: "Confirm reinsertion, then submit the second pass.")
        stepDots(5)
        rounded(CGRect(x: 260, y: 215, width: 760, height: 180), radius: 18, fill: .white, stroke: NSColor(calibratedWhite: 0.82, alpha: 1))
        rounded(CGRect(x: 310, y: 300, width: 34, height: 34), radius: 5, fill: green)
        text("✓", CGRect(x: 310, y: 300, width: 34, height: 34), size: 25, color: .white, weight: .bold, alignment: .center)
        text("The stack is reinserted correctly", CGRect(x: 365, y: 302, width: 570, height: 34), size: 22, weight: .semibold)
        rounded(CGRect(x: 520, y: 238, width: 430, height: 52), radius: 9, fill: burgundy)
        text("Print back sides and deduct materials", CGRect(x: 535, y: 251, width: 400, height: 27), size: 17, color: .white, weight: .semibold, alignment: .center)
    } else {
        let a = local(t, 34, 35)
        context.saveGState(); context.setAlpha(a)
        text("✓", CGRect(x: 72, y: 390, width: 1136, height: 110), size: 86, color: green, weight: .bold, alignment: .center)
        text("Back-to-back printing complete", CGRect(x: 72, y: 300, width: 1136, height: 70), size: 45, weight: .bold, alignment: .center)
        text("For odd page counts, Print-MS leaves the final back blank.", CGRect(x: 72, y: 245, width: 1136, height: 38), size: 23, color: muted, alignment: .center)
        context.restoreGState()
    }
    NSGraphicsContext.restoreGraphicsState()
}

try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_500_000]
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height
])
guard writer.canAdd(input) else { fatalError("Cannot add video input") }
writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
let frames = Int(duration * Double(fps))
for frame in 0..<frames {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32ARGB, [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
    ] as CFDictionary, &buffer)
    guard let pixel = buffer else { fatalError("Cannot create frame") }
    CVPixelBufferLockBaseAddress(pixel, [])
    let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height,
                            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel),
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    drawFrame(t: Double(frame) / Double(fps), context: context)
    adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(frame), timescale: fps))
    CVPixelBufferUnlockBaseAddress(pixel, [])
}
input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
if writer.status != .completed { fatalError(writer.error?.localizedDescription ?? "Video export failed") }
print(output.path)
