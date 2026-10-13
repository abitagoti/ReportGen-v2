# Stage 4 Login Cleanup — 2026-10-03

## Change
- A normal signed-out first load calls `/api/auth/me`, which correctly returns HTTP 401.
- The frontend now treats that 401 as an expected signed-out state and does not display `Authentication required.` on the login screen.
- Other authentication/workspace errors continue to be surfaced.
- API errors now retain their HTTP status on the thrown Error object so the boot flow can distinguish expected 401 from other failures.
- Cache-busted `public/index.html` to load the corrected app bundle.

## Verification
- All JavaScript files must pass `node --check`.
- Package must be re-extracted and all extracted JavaScript checked before delivery.
