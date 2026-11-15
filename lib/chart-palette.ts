/**
 * Chart colours — CSS variables from app/styles/tokens.css, VALIDATED with
 * the dataviz skill's validate_palette.js against the white card surface:
 *
 *  STATUS / SCORE (hot · warm · cold, and available · blocked · sold) —
 *    "#0f6b46,#daa24c,#b23a2f" → ALL PASS (adjacent normal ΔE ≥ 25.6).
 *    Ochre fill WARNs on contrast (2.21:1), so every part carries a visible
 *    label + count and a table view. Always in this fixed order.
 *  SINGLE-SERIES BARS (leads by stage, funnel) — one hue, forest.
 */
export const SCORE_COLOR = { hot: "var(--color-forest)", warm: "var(--color-chart-caution)", cold: "var(--color-rust)" } as const;
export const UNIT_COLOR = { available: "var(--color-forest)", blocked: "var(--color-chart-caution)", sold: "var(--color-rust)" } as const;
