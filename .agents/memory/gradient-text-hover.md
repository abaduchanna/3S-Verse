---
name: gradient-text hover bug
description: Gradient text (bg-clip-text) disappears on hover when the gradient is on a parent and a filter is applied to a child link.
---

# Gradient text + hover filter bug

**Rule:** When using `bg-clip-text` with `text-transparent`, apply the gradient on the same element that receives the hover `filter`/`drop-shadow`. Do NOT put the gradient on a parent `<nav>` and the `hover:drop-shadow` on child `<a>` links.

**Why:** A CSS `filter` (which `drop-shadow` is) on a child creates a new stacking context, which breaks the ancestor's `background-clip: text`. The link text is `transparent`, so it becomes invisible on hover. This affected the 3S Verse nav links when the gradient + clip were moved onto the shared parent nav.

**How to apply:** For any linked gradient text that needs a hover glow, put `bg-gradient-to-r ... bg-clip-text text-transparent` AND the `hover:drop-shadow-...` on the same `<a>` element. Verified: cabining the gradient per-link (like the mobile menu) makes hover work in both light and dark themes. The "continuous gradient across a row of links" pattern is incompatible with per-link hover filters; choose per-link gradient instead.
