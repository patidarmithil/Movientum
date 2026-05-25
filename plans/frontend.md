# Frontend Design Reference - Moctale Theme System

This document serves as a reference for the design language, color palette, component layout rules, and interactive patterns reverse-engineered from [Moctale.in](https://moctale.in).

---

## 1. Core Color System

The platform operates on a deep, neutral dark mode utilizing absolute grays and electric accents.

| Token | CSS Variable / Value | Description |
|---|---|---|
| **Base Background** | `#080808` | Deep void/dark page backdrop |
| **Surface Card** | `#1B1B1B` | Raised component box, list rows, headers |
| **Layer / Input** | `#2A2A2A` | Active tabs, inner layers, text inputs |
| **Border Stroke** | `#252833` | Hard borders separating columns and cards |
| **Main Text** | `#ffffff` | Primary text and high-contrast labels |
| **Muted Text** | `#9CA3AF` | Subtext, timestamps, and secondary info |
| **Brand Accent** | `#B048FF` | Electric purple used for logos, actives, focus highlights |

---

## 2. Rating Categories (Moctale Meter)

The rating structure completely bypasses numeric stars or decimals in favor of a 4-tiered qualitative meter system.

| Category | Hex Color | Key | Edge Weight (Local GNN) |
|---|---|---|---|
| **Skip** 🔴 | `#FF4D6D` | `skip` | `-1.0` (Strong Negative) |
| **Timepass** 🟡 | `#FFC300` | `timepass` | `+0.3` (Weak Positive) |
| **Go for it** 🟢 | `#00E5A0` | `go_for_it` | `+0.7` (Recommend) |
| **Perfection** 🟣 | `#9B59FF` | `perfection` | `+1.0` (Masterpiece) |

---

## 3. Typography & Spacing Guidelines

- **Primary Font**: `Inter, sans-serif` (modern, high legibility in dark setups).
- **Secondary Font**: `Outfit, sans-serif` (heavy weights used exclusively for headers and brand logos).
- **Borders**: Stark, crisp borders (`1px solid var(--mp-border)`) instead of soft shadows.
- **Neo-Brutalist Layouts**: Flat panels, sharp corners (12px to 16px radius), high-contrast colored badges, and explicit borders.

---

## 4. Semicircular Gauge Component Spec

To render the Moctale Meter distribution:
- **Geometry**: Rendered as a 180° SVG semicircle using a radius `R = 80` path:
  `d="M 20 100 A 80 80 0 0 1 180 100"`
- **Path Length (L)**: `PI * R ≈ 251.327` pixels.
- **Dash Stacking Formula**: Draw each category segment side-by-side using `stroke-dasharray`:
  - **Skip**: `0 0 ${skip_len} ${L}`
  - **Timepass**: `0 ${skip_len} ${timepass_len} ${L}`
  - **Go for it**: `0 ${skip_len + timepass_len} ${goforit_len} ${L}`
  - **Perfection**: `0 ${skip_len + timepass_len + goforit_len} ${perfection_len} ${L}`
- **Interactive Controls**: Placed directly below the meter as a pill grid. Clicking triggers an instant recalculation of percentage slices and highlights selected pill border.
