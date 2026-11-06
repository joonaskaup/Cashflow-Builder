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

## Local setup

Use Python 3.12 and the pinned packages in `requirements.txt`. The macOS application release includes a relocatable Apple silicon Python runtime in `app/runtime/python`. The source archive does not include that runtime.

For engine work, create a virtual environment and install the requirements. To exercise the actual launcher and all integration tests, use the bundled runtime from a trusted Cashflow Builder release, copied into `app/runtime`. Keep dependency licence files with it.

Build the offline help after changing the Markdown guide:

```sh
python3 scripts/build_docs.py
```

On a Mac with the runtime in place:

```sh
app/runtime/python/bin/python3 -I scripts/package.py
app/runtime/python/bin/python3 -I scripts/check.py
```

Node.js is needed for the JavaScript tests, but not for end users. Tests open loopback servers and use isolated temporary projects. The acceptance test also exercises macOS `sandbox-exec` and `ditto`, so it must run on macOS outside a sandbox that forbids those operations.

The app can be launched with `app/Start Cashflow Builder.command`. Use fictional data for development and demonstrations.

## Release procedure

1. Update `app/version.py`, the changelog, guide version and download filename in the README. Keep the version and date consistent.
2. Build help, run the package script, then run `scripts/check.py` using the bundled runtime. Packaging rejects unexpected first-party files and never includes Projects or backups.
3. Check the archive inventory and hashes. Test a fresh unzip, launch, fictional import, save/reopen and update of an older test installation.
4. Commit the source and documentation, then tag the exact tested commit `v<version>`.
5. Push the commit and tag. Publish a GitHub release with the versioned macOS ZIP and its SHA-256 checksum. Source-only ZIPs are not end-user installers.
6. Include the supported platform, update instructions and material limitations in the release notes. Retain prior releases for rollback.

Do not commit real budgets, extracted state, user projects, project names, session secrets or credentials. The Git ignore rules are a second line of defence; publish from the clean source folder only. A new release does not update a user's budget by itself.

No open-source licence has been selected for this repository. Included third-party components retain their own licences and attribution in `app/THIRD PARTY NOTICES.md` and the packaged runtime.
