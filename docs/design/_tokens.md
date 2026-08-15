# Tokens — where they actually live

This file is a pointer. It deliberately contains **no token values**.

A second copy of the palette in `docs/` drifts from the real one and then gets believed. If you want to know what `--chart-3` is, read the source, not this.

---

## The source of truth

| What | Where |
|---|---|
| Color tokens, light theme | `app/assets/css/tailwind.css` → `:root` |
| Color tokens, dark theme | `app/assets/css/tailwind.css` → `.dark` |
| Tailwind theme mapping (`--color-*`, `--radius-*`, `--font-*`) | `app/assets/css/tailwind.css` → `@theme inline` |
| shadcn-vue registry config (style, base color, icon library, aliases) | `components.json` |
| Spacing, breakpoints, type scale | Tailwind 4 defaults — no override in this repo |

Tailwind 4 is configured in CSS, not in a `tailwind.config.ts`. There is no JS config file to look for.

---

## What exists

Semantic surface tokens (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`), the sidebar set (`--sidebar*`), the chart series `--chart-1` … `--chart-5`, and `--radius` with its `sm`/`md`/`lg`/`xl` derivations.

Every one of them is defined twice — once under `:root` and once under `.dark`. Both themes always work; that isn't optional.

Type is Figtree, exposed as `--font-sans`, with `--font-heading` currently aliased to it.

---

## Rules

1. **Use the token, not the value.** `bg-card`, `text-muted-foreground`, `border-border` — never a hex or `oklch()` literal in a component.
2. **Chart series come from `--chart-1` … `--chart-5`.** Five slots. A chart needing a sixth series is a design conversation, not a new CSS variable invented at the call site.
3. **Specs name tokens.** A spec in this directory that mentions a color names the token. If you find a hex value in a `spec.md`, that's a bug in the spec.
4. **A design value with no matching token is a discrepancy.** Raise it in the PR. Do not hardcode it, and do not add a token unilaterally to make one screen work.

---

## Changing a token

Edit `app/assets/css/tailwind.css`, both the `:root` and `.dark` blocks. Check every screen that uses it in both themes. Nothing in `docs/design/` needs updating when a token changes — that's the point of this file containing no values.
