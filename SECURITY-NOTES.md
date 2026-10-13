# ReportGen security dependency notes

## Changes in this revision

- Electron is pinned to `44.4.5` in `package.json`, which is beyond the vulnerable Electron ranges reported by the previous `npm audit` output.
- The application keeps `xlsx@0.18.5` because the importer currently supports XLS/XLSX files through SheetJS. npm reports no upstream fix for the listed `xlsx` advisories. Replacing it requires a separate importer migration and regression test pass, especially for legacy `.xls` files.
- Do not run `npm audit fix --force` blindly: npm reported that it would perform a breaking Electron upgrade. The Electron version is now set deliberately instead.

## Install/update command on Windows

```bat
npm install
npm approve-scripts --all
npm rebuild better-sqlite3
npm audit
```

Review the remaining `xlsx` advisory before production deployment. If XLS support is no longer required, migrate the importer to a maintained library and remove `xlsx` in a dedicated change.
