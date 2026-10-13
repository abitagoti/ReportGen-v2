# ReportGen data size and retention notes

## What an import stores

ReportGen reads the selected Excel or CSV file in memory during import. It does not retain a second copy of the original upload. It stores normalized sales transaction rows in `sales_transactions`, plus a small import summary and limited validation issues in `sales_imports` and `sales_import_issues`.

Deleting a sales import also deletes its transaction rows through the database relationship. Automatic cleanup of old imports would therefore erase sales history and change five-year reports. The app does not automatically delete sales transactions or import records.

## Five-year retention

Keeping five years of normalized sales records is reasonable. The current app uses SQLite with date indexes and date-range queries for monthly and annual views. A one-time index build can take extra time on a large existing database; subsequent month and year queries can use those indexes.

The database can grow to several gigabytes, but keep the live database and its backups on a drive with sufficient free space. Automatic monthly backups are full database copies and the current retention limit is twelve copies. A 4 GB live database can therefore require about 48 GB for twelve monthly copies, in addition to the live database and temporary restore/migration space.

## Safe cleanup and archive direction

Do not automatically delete transaction rows. If storage becomes a problem, first make and verify an external backup. A future archive feature should export a complete year, verify its totals and row counts, then keep that year searchable in reports before any hot-database removal is offered. Cleanup should be an explicit administrator action with a clear preview and confirmation.

A useful next management screen would show live database size, backup size, oldest/newest transaction dates, and available disk space. It could offer verified backup export and yearly archive creation before offering any deletion.
