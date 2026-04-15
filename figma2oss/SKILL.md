---
name: figma2oss
description: Export uploadable assets from Figma nodes and publish them through the `figma2oss` MCP service, returning CDN/OSS URLs and asset mappings for downstream implementation. Use when Codex needs to work with Figma images, icons, SVGs, or screenshots as publishable assets, especially when the user explicitly invokes /figma2oss or $figma2oss, or combines it with /figma to inspect a design and then push selected assets to OSS/CDN.
---

# Figma2OSS

## Overview

Use this skill to bridge Figma MCP asset discovery with the `figma2oss` MCP service. Keep it as an independent skill: it should work on its own, and it should also compose naturally with `$figma` when the user writes `/figma /figma2oss` or `$figma $figma2oss` in the same request.

## Required workflow

Follow this sequence. Do not skip steps.

1. Confirm the source node.
- If the user provides a Figma URL, extract the `node-id` and use it.
- If no URL is provided but Figma desktop MCP is available, use the current selection.
- If neither is available, stop and ask for the exact Figma node or link.

2. Inspect the node with Figma MCP first.
- Run `get_design_context` for the target node.
- Run `get_screenshot` when a visual check helps confirm the right asset source.
- Use `get_metadata` only when the node is too large and child-node targeting is needed.

3. Identify export-worthy assets only.
- Prefer assets actually present in the Figma payload.
- Focus on images, icons, SVGs, illustrations, and other static media that should be published to OSS/CDN.
- Do not invent placeholders and do not add third-party icon packages.

4. Upload with the `figma2oss` MCP service.
- Prefer MCP tools exposed under a service name containing `figma2oss`.
- If Figma returns localhost asset URLs, pass those URLs to the `figma2oss` upload tool as the preferred source.
- If the asset is returned as raw SVG or image data instead of a URL, upload the asset using the appropriate content type.
- Preserve meaningful filenames when they can be inferred from the node or layer name.
- Keep related assets in a shared folder prefix when the task covers one screen or component.

5. Return a clean mapping for downstream use.
- Report each uploaded asset with a stable source label, original asset hint, and final CDN/OSS URL.
- When the user is also implementing UI from Figma, structure the result so it can be reused directly in code changes.
- If some assets were intentionally skipped, say why.

## Composition rules

Treat this skill as independent, not as an extension hidden inside another skill.

- If the user invokes only `$figma2oss`, perform the asset-export and upload workflow directly.
- If the user invokes both `$figma` and `$figma2oss`, let `$figma` handle design inspection and let this skill handle publishable asset extraction plus OSS/CDN upload.
- Do not require the user to invoke a special combined skill.
- Do not rewrite application code unless the user explicitly asks for code changes.

## Output contract

Return concise, implementation-ready results.

- Include the target node reference that was used.
- Include a flat asset mapping list in the form `source -> cdn_url`.
- Include any upload folder or grouping convention used.
- Include blockers for assets that could not be uploaded.

When useful, format the mapping like this:

```text
assets:
- hero-image -> https://cdn.example.com/path/hero-image.png
- filter-icon -> https://cdn.example.com/path/filter-icon.svg
```

## Fallbacks and guardrails

- If Figma MCP is unavailable, stop and explain that the Figma node context cannot be collected yet.
- If the `figma2oss` MCP service is unavailable, stop after listing the assets that should be uploaded.
- If no tool name contains `figma2oss`, look for the compatible asset upload tool the user explicitly configured and state that fallback clearly.
- If both URL-based and raw-data upload are possible, prefer the source that preserves fidelity with the least manual transformation.
- If the user asks for code rewriting too, perform that only as an explicit follow-up or when the request clearly includes code updates.

## Reference

For prompt patterns and expected result shapes, read `references/workflow.md`.
