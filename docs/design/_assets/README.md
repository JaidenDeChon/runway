# Design runtime assets

Verbatim runtime assets exported from the Claude Design project
(`310b7c15-1238-44b4-b73f-88315f12f8d3`), copied here unmodified.

They exist for exactly one reason: so that the `reference.html` in each
`docs/design/<screen>/` folder renders offline, without network access.

**These are not a token source.** The repo's design tokens live in
`app/assets/css/tailwind.css`. Do not import, extend, or copy values out of
these files into application code. If a screen's spec needs a color, spacing,
or type value, it names a repo token — and if no repo token matches, that is a
discrepancy to record in the screen's spec under "Open questions", not a value
to hardcode.

Contents (relative structure preserved as exported):

- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/_ds_bundle.js`
- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/components/fig-assets.css`
- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/components/fig-tokens.css`
- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/styles.css`
- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/tokens/fonts.css`
- `_ds/runway-design-system-f152bc89-bf47-4491-8e5d-44f0a9ec8df4/tokens/theme.css`
- `support.js`

Each `reference.html` has its asset references rewritten to point at this
folder (`../_assets/...`); the files themselves are untouched.
