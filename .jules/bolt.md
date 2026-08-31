# Bolt's Journal - Critical Learnings

## 2026-07-19 - HTML & CSS Rendering Optimization for Static Pages
**Learning:** Adding `<meta charset="UTF-8">` early in `<head>` allows browser HTML parsers to process bytes immediately without restart penalties. Using `content-visibility: auto` on lower page sections allows browser layout engine to skip rendering offscreen elements during initial page load.
**Action:** Always include early `<meta charset="UTF-8">`, viewport tags, and `content-visibility` optimizations on landing pages to reduce First Contentful Paint (FCP) and improve paint performance.
