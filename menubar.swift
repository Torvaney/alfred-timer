// A menu bar countdown for the timers set by timer.js.
//
// Reads the timers' plists from the workflow's data folder, shows the next one
// to finish in the menu bar, and quits once there are none left. It only shows
// timers: launchd still fires them, so they go off even if this isn't running.
//
// Started by timer.js (via launchd), with alfred_workflow_data set.

import AppKit

struct Entry {
  let id: String
  let title: String
  let seconds: Int
  let end: Date

  var name: String { title.isEmpty ? formatDuration(seconds) : title }
}

func formatDuration(_ seconds: Int) -> String {
  let parts = [(seconds / 3600, "hour"), (seconds % 3600 / 60, "minute"), (seconds % 60, "second")]
  return parts
    .filter { $0.0 > 0 }
    .map { "\($0.0) \($0.1)\($0.0 == 1 ? "" : "s")" }
    .joined(separator: " ")
}

func formatRemaining(until end: Date) -> String {
  let seconds = Int(ceil(end.timeIntervalSinceNow))
  if seconds <= 0 {
    return "done"
  }
  let (h, m, s) = (seconds / 3600, seconds % 3600 / 60, seconds % 60)
  return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

func loadEntries(from dir: URL) -> [Entry] {
  let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
  return files
    .filter { $0.pathExtension == "plist" }
    .compactMap { url in
      guard
        let plist = NSDictionary(contentsOf: url),
        let vars = plist["EnvironmentVariables"] as? [String: String],
        let id = vars["timer_id"],
        let seconds = Int(vars["timer_seconds"] ?? ""),
        let end = Double(vars["timer_end"] ?? "")
      else { return nil }
      return Entry(id: id, title: vars["timer_title"] ?? "", seconds: seconds, end: Date(timeIntervalSince1970: end / 1000))
    }
    .sorted { $0.end < $1.end }
}

@MainActor
final class MenuBarController: NSObject {
  let dataDir: URL
  let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var shownIDs: [String] = []

  init(dataDir: URL) {
    self.dataDir = dataDir
    super.init()

    if let button = statusItem.button {
      button.image = NSImage(systemSymbolName: "timer", accessibilityDescription: "Timer")
      button.imagePosition = .imageLeading
      // Monospaced digits stop the menu bar item from jiggling as it counts down
      button.font = .monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    }
    statusItem.menu = NSMenu()

    update()
    // Common run loop mode, so the countdown keeps updating while the menu is open
    let timer = Timer(timeInterval: 1, repeats: true) { _ in
      MainActor.assumeIsolated { self.update() }
    }
    RunLoop.main.add(timer, forMode: .common)
  }

  func update() {
    let entries = loadEntries(from: dataDir.appendingPathComponent("timers"))
    guard let next = entries.first else {
      NSApp.terminate(nil)
      return
    }

    let more = entries.count > 1 ? " +\(entries.count - 1)" : ""
    statusItem.button?.title = " \(next.name) \(formatRemaining(until: next.end))\(more)"

    // Only rebuild the menu when timers are added or removed, so it doesn't
    // flicker while open; otherwise just update the countdowns
    if entries.map(\.id) != shownIDs {
      rebuildMenu(entries)
    }
    for (item, entry) in zip(statusItem.menu?.items ?? [], entries) {
      item.title = "\(entry.name)  \(formatRemaining(until: entry.end))"
    }
  }

  func rebuildMenu(_ entries: [Entry]) {
    let menu = NSMenu()
    let clock = DateFormatter()
    clock.timeStyle = .short

    for entry in entries {
      let submenu = NSMenu()
      submenu.addItem(withTitle: "Ends at \(clock.string(from: entry.end))", action: nil, keyEquivalent: "")
      let cancel = submenu.addItem(withTitle: "Cancel", action: #selector(cancel(_:)), keyEquivalent: "")
      cancel.target = self
      cancel.representedObject = entry.id

      let item = menu.addItem(withTitle: entry.name, action: nil, keyEquivalent: "")
      item.submenu = submenu
    }

    menu.addItem(.separator())
    let quit = menu.addItem(withTitle: "Hide Until Next Timer", action: #selector(quit), keyEquivalent: "")
    quit.target = self

    statusItem.menu = menu
    shownIDs = entries.map(\.id)
  }

  @objc func cancel(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }

    // Cancel via timer.js, so there's only one place that manages launchd jobs
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-l", "JavaScript", dataDir.appendingPathComponent("timer.js").path, "cancel"]
    process.environment = ProcessInfo.processInfo.environment.merging(
      ["alfred_workflow_data": dataDir.path, "timer_id": id],
      uniquingKeysWith: { $1 }
    )
    try? process.run()
    process.waitUntilExit()
    update()
  }

  @objc func quit() {
    NSApp.terminate(nil)
  }
}

guard let dataDir = ProcessInfo.processInfo.environment["alfred_workflow_data"] else {
  FileHandle.standardError.write("alfred_workflow_data is not set\n".data(using: .utf8)!)
  exit(1)
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let controller = MenuBarController(dataDir: URL(fileURLWithPath: dataDir))
  withExtendedLifetime(controller) { app.run() }
}
