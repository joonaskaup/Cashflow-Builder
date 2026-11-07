# Development and releases

The `app` folder is the canonical application source. Edit it directly. The historical transformation scripts used during development are not part of this repository.

## Layout

- `app/helper`: planning engine, workbook handling and project UI.
- `app/welcome`: local project chooser.
- `app/local_app.py`: local servers, import and project management.
- `app/update_app.py`: code-only updater and rollback.
- `app/Example/Fictional budget.xlsx`: the sole committed workbook; synthetic test data.
- `docs/USER_GUIDE.md`: canonical user instructions.
- `scripts/build_docs.py`: builds the standalone offline HTML guide using the standard library.
- `scripts/package.py`: allowlisted ZIP package and checksum.
- `tests`: Python and JavaScript regression tests using fictional data.
- `app/runtime`: ignored local release dependency; never committed.
- `dist`: ignored packaged releases.

## Building the Mac app

Use an isolated Python 3.12 environment and install `requirements-build.txt`. The tested build uses Python 3.12.14 and PyInstaller 6.22.3 on Apple silicon. Xcode Command Line Tools are required for the native Swift launcher and icon.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
.venv/bin/python scripts/build_macos.py
.venv/bin/python tests/accept_macos.py
```

If the default SDK is newer than the installed Swift compiler, set `SDKROOT` to an installed compatible macOS SDK. The tested compiler/SDK combination uses macOS 15.4 SDK with an arm64 macOS 12 deployment target.

The builder collects only application assets, the fictional workbook and dependency licences. PyInstaller bundles the Python engine. A native launcher owns its sandboxed process, handles Dock reopening and confirms quitting. All nested binaries and the outer app are locally signed; the builder fails if strict signature verification fails. Local signing is not Developer ID signing or Apple notarization.

The resulting `.app` and ZIP are under `dist`. Use the `-app.zip` asset for the new distribution. Do not replace a published asset without changing its version and checksum.

The functional acceptance script uses temporary fictional projects, relocates the app and project storage, checks preserved timing, and verifies that use has not changed the signed bundle. It does **not** bypass or prove Gatekeeper approval. Test a real browser download separately, without stripping quarantine. An unsigned first-open exception requires the tester's deliberate approval.

## Regression checks and legacy folder package

`app` remains the canonical source. `docs/USER_GUIDE.md` generates offline `app/help.html` through `scripts/build_docs.py`.

The older folder-package regression tests use a relocatable runtime at `app/runtime/python` copied from a trusted release. Build that test package with `scripts/package.py`, then run `scripts/check.py`. Node.js is required for the JavaScript tests. Tests open loopback servers and require macOS sandbox-exec and ditto. They never need real projects.

## Release procedure

1. Update `app/version.py`, the changelog, guide version and download filename in the README. Keep the version and date consistent.
2. Run the regression checks, build the Mac app with `scripts/build_macos.py`, then run `tests/accept_macos.py` against its ZIP. The legacy folder tests also require `scripts/package.py` before `scripts/check.py`. Packages never include Projects or backups.
3. Check the archive inventory and hashes. Test a fresh unzip, launch, fictional import, save/reopen and update of an older test installation.
   Also test a browser-downloaded release on a clean Mac account. A local ZIP/launch test does not exercise download quarantine or establish Gatekeeper acceptance. Record signing/notarization status and any first-open prompts; never describe local launch success as an Apple security check.
4. Commit the source and documentation, then tag the exact tested commit `v<version>`.
5. Push the commit and tag. Publish a GitHub release with the versioned macOS ZIP and its SHA-256 checksum. Source-only ZIPs are not end-user installers.
6. Include the supported platform, update instructions and material limitations in the release notes. Retain prior releases for rollback.

Do not commit real budgets, extracted state, user projects, project names, session secrets or credentials. The Git ignore rules are a second line of defence; publish from the clean source folder only. A new release does not update a user's budget by itself.

No open-source licence has been selected for this repository. Included third-party components retain their own licences and attribution in `app/THIRD PARTY NOTICES.md` and the packaged runtime.
