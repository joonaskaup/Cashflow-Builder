# Mac distribution check — 7 November 2026

Artifact: `Cashflow-Builder-0.2.0rc1-macos-arm64-app.zip`, from tag `v0.2.0rc1` (`ba4dda4`).

SHA-256: `d60c3ef512d365f2bf4727e02866ebc9523d7839d59ea499e7043bc419b8976c`.

This preview uses local (ad-hoc) signatures. It has no Developer ID signature or Apple notarization.

| Check | Result |
| --- | --- |
| Regression suite | 99 Python and 43 JavaScript tests passed. |
| ZIP contents and nested signatures | Passed strict verification; no Projects, command launchers or standalone Python launcher included. |
| Fictional project lifecycle | Import, save, refresh, report and shutdown passed with the frozen engine. |
| Relocation | Moving the app and copying project storage preserved saved timing and allowed reopening. |
| Real browser download | Downloaded the published GitHub asset; checksum matched. |
| Download security metadata | Browser attached `com.apple.quarantine`; copying to an isolated test directory and expanding with Archive Utility preserved it on the app. |
| Initial Gatekeeper assessment | Rejected. System Settings offered **Open Anyway** for **Cashflow Builder**. |
| Launch after deliberate approval | Tester completed Open Anyway on the Mac; the app opened. The native launcher and bundled engine ran from macOS App Translocation. |
| Separate component warnings after approval | None observed during fictional import, opening the project, saving a payment and exporting an Excel report. |
| Normal reopening | Stopped through the app, reopened the same approved copy from Finder without another approval, and reopened the fictional project with its saved €1,500 payment intact. |

No quarantine attributes were removed and Gatekeeper was not disabled. The single-app approval route passed on this Mac. This is not Apple notarization or a guarantee for other Macs. An independent clean-account or second-Mac test remains before a general release; the development Mac has run local builds.

The published 0.1.0 folder release remains available, with a warning about repeated launcher/Python/library prompts. The preview is not marked as the latest regular release.
