import Cocoa

// This launcher owns the sandboxed engine. Project data never goes in the bundle.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var worker: Process?
    var homeURL: URL?
    var buffer = Data()
    var output: Pipe?
    var errors: Pipe?
    var stopping = false
    var stoppedFromBrowser = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Open Cashflow Builder", action: #selector(reopen), keyEquivalent: "o")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Cashflow Builder", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = menu
        launch()
    }

    @objc func reopen() { if let url = homeURL { NSWorkspace.shared.open(url) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        reopen(); return false
    }

    func launch() {
        guard let executable = Bundle.main.executableURL,
              let resources = Bundle.main.resourceURL else { fail("The application bundle is incomplete."); return }
        let engine = executable.deletingLastPathComponent().appendingPathComponent("CashflowEngine")
        let sandbox = resources.appendingPathComponent("offline.sb")
        guard FileManager.default.isExecutableFile(atPath: engine.path),
              FileManager.default.fileExists(atPath: sandbox.path),
              FileManager.default.isExecutableFile(atPath: "/usr/bin/sandbox-exec") else {
            fail("The bundled engine or required local network sandbox is missing. Download the complete app again."); return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sandbox-exec")
        var arguments = ["-f", sandbox.path, engine.path, "manager"]
        // Isolated acceptance tests can supply a temporary data location explicitly.
        if let index = CommandLine.arguments.firstIndex(of: "--projects"), index+1 < CommandLine.arguments.count {
            arguments.append(CommandLine.arguments[index+1])
        }
        arguments.append("--no-browser")
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        for key in ["PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "DYLD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES"] {
            environment.removeValue(forKey: key)
        }
        process.environment = environment
        process.currentDirectoryURL = resources
        let out = Pipe(), err = Pipe()
        output = out; errors = err
        process.standardOutput = out
        process.standardError = err
        // Drain stderr without persisting project names or workbook paths in a log.
        err.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.receive(data) }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.stopping { NSApp.reply(toApplicationShouldTerminate: true); return }
                if process.terminationStatus != 0 || self.homeURL == nil {
                    self.fail("Cashflow Builder could not start or stopped unexpectedly. Your saved projects remain in their Projects folder.")
                } else {
                    self.stoppedFromBrowser = true
                    NSApp.terminate(nil)
                }
            }
        }
        worker = process
        do { try process.run() }
        catch { fail("Cashflow Builder could not launch its bundled engine. Download the complete app again.") }
    }

    func receive(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = String(data: buffer[..<newline], encoding: .utf8) ?? ""
            buffer.removeSubrange(...newline)
            // The engine's own local URL is the only value opened automatically.
            guard let start = line.range(of: "http://127.0.0.1:"),
                  let url = URL(string: String(line[start.lowerBound...])),
                  url.host == "127.0.0.1", url.scheme == "http", url.fragment != nil else { continue }
            homeURL = url
            NSWorkspace.shared.open(url)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !stoppedFromBrowser, let process = worker, process.isRunning else { return .terminateNow }
        if stopping { return .terminateLater }
        let alert = NSAlert()
        alert.messageText = "Save your work before quitting"
        alert.informativeText = "Unsaved payment and date edits are kept in the browser until you save them. Return to Cashflow Builder and save before quitting."
        alert.addButton(withTitle: "Return to app")
        alert.addButton(withTitle: "Quit")
        if alert.runModal() == .alertFirstButtonReturn { reopen(); return .terminateCancel }
        stopping = true
        process.terminate()
        return .terminateLater
    }

    func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Cashflow Builder could not open"
        alert.informativeText = message
        alert.addButton(withTitle: "Close")
        alert.runModal()
        stoppedFromBrowser = true
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
