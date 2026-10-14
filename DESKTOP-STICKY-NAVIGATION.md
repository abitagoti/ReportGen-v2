# Desktop Sticky Navigation Update

- Keeps the desktop sidebar pinned to the viewport while the main workspace scrolls.
- Allows the navigation list to scroll independently when the available screen height is limited.
- Keeps the bottom controls, including Sign out, anchored at the bottom of the sidebar.
- Applies only at widths above 850px; existing mobile navigation behavior is unchanged.
- Uses existing styles and colors; no accounting calculations or database behavior changed.


General Company Report follow-up: added a page-specific shell class and explicit desktop sticky sidebar rules so the report page uses the same pinned navigation behavior as the other modules. Mobile breakpoint behavior is unchanged.
