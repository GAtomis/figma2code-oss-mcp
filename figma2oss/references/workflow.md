# Figma2OSS Workflow Reference

## Typical prompts

- `Use $figma2oss to upload the icons from this Figma node and return the CDN links.`
- `Use $figma $figma2oss to inspect this frame, find all exportable assets, and publish them to OSS.`
- `Export the illustrations from the selected Figma node with $figma2oss and give me a source-to-CDN mapping.`

## Recommended execution shape

1. Resolve the node from URL or current selection.
2. Inspect with `get_design_context`.
3. Capture `get_screenshot` if asset identity is ambiguous.
4. Collect asset URLs or raw asset payloads from the Figma response.
5. Upload them via the `figma2oss` MCP service, preferring tools whose service name contains `figma2oss`.
6. Return a compact mapping plus any skipped assets.

## Result shape

```text
node: 123:456
folder: figma/homepage-hero
assets:
- background-pattern -> https://cdn.example.com/figma/homepage-hero/background-pattern.svg
- chart-preview -> https://cdn.example.com/figma/homepage-hero/chart-preview.png
skipped:
- avatar-stack: decorative vector already implemented in code
```

## Decision notes

- Prefer exporting only the assets that need hosting.
- Keep repeated exports for the same frame under one folder prefix.
- Preserve SVG where possible; avoid rasterizing vectors unless the source itself is raster.
- If multiple layers represent one logical asset, name the output after the logical usage, not an arbitrary layer id.
