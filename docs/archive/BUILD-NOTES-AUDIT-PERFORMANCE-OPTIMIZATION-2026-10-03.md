# Audit Log Performance Optimization — 2026-10-03

## Problem
The Audit Log page could become extremely slow on large audit tables. The previous API requested a page of rows **and** ran a full `COUNT(*)` for every page request. The UI also loaded audit metadata before loading the first page.

## Changes
- Audit API no longer performs a full-table `COUNT(*)` on every request.
- API fetches `limit + 1` rows and returns `pagination.hasMore` instead.
- Audit page defaults to the **last 30 days** instead of implicitly querying the entire company history.
- Added an explicit **All history** option for users who intentionally need the complete history.
- Date-range filtering remains available with From/To.
- Search, action, user and business filters remain available.
- First audit page now loads before metadata, so a large metadata query cannot block the initial audit results.
- Metadata is populated into the existing filter controls after the first page is available.
- Previous/Next pagination no longer requires a total-count query.
- Existing indexed filters on company/time, action, user and business remain in place.

## Expected behavior
Opening Audit Log should now show recent records quickly even when the audit table is large. Users can narrow by date range and/or search term, or deliberately enable All history.

## Verification
- `node --check` on all JavaScript files: PASS.
- Existing audit/security regression tests: PASS.
- Final archive is re-extracted and all extracted JavaScript files are syntax-checked before delivery.
