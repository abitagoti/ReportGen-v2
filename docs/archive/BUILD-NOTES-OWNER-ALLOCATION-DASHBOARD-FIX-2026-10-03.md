# ReportGen — Owner Allocation Dashboard Fix — 2026-10-03

## Changes
- Removed the extra explanatory paragraphs from the CEO / Owner expense allocation panel to make the dashboard section more compact.
- Kept the useful gross-profit base as a compact line so the preview calculation remains clear.
- Removed the bottom calculation explanation from the panel.
- Fixed the live percentage preview bug: the input handlers were referencing `allocationBase` and `selectedOwnerGrossProfit` variables that only existed inside the `dashboard()` render function. Typing a percentage therefore could not update the preview.
- Preview bases are now read from the current dashboard state at input time, so typing updates the amount immediately without saving first.
- Both default allocation and selected-business allocation previews are supported.

## Verification
- `node --check public/js/pages/dashboard.js` passed.
- All JavaScript files in the packaged source (excluding node_modules) were syntax-checked before packaging.
- The final ZIP was tested with `unzip -tq` and re-extracted.
- All JavaScript files in the re-extracted ZIP were syntax-checked again.
