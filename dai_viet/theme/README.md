# Dai Viet internal UI theme

This folder contains the UI layer that makes the Dai Viet internal screens match the
new light/dark Figma direction without editing vendor CSS.

- `dai-viet-tokens.css`: color, radius, spacing, and component tokens for light and dark mode.
- `dai-viet-ui.css`: w2ui/NUT component overrides that consume the tokens.
- `../js/ui-theme.js`: reads `localStorage.theme` or `?theme=...`, sets `data-dv-theme`,
  and exposes `window.DaiVietUI`.
- `preview.html`: static w2ui/NUT markup for checking the theme without logging in.

Use these theme values:

- `sp`: light mode.
- `sp-dark`: dark mode.

When adding new internal UI, prefer token variables from `dai-viet-tokens.css` instead
of hard-coded colors.

Preview URLs:

- `theme/preview.html?theme=sp`
- `theme/preview.html?theme=sp-dark`
