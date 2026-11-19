# Third-party notices

The production build generates `dist/THIRD_PARTY_NOTICES.txt` from the packages actually included in the bundle, preserving available licence and notice text. That file is included in the VSIX. Legal comments remain in the bundle.

Principal dependencies:

- TrueForge harness 0.180.1: https://github.com/truefoundry/trueforge (MIT; separately installed development/local runtime).
- Model Context Protocol TypeScript SDK 1.26.0: https://github.com/modelcontextprotocol/typescript-sdk (MIT).
- jsdiff 8.0.2: https://github.com/kpdecker/jsdiff (BSD-3-Clause).
- ignore 7.0.5: https://github.com/kaelzhang/node-ignore (MIT).
- highlight.js 11.11.1: https://github.com/highlightjs/highlight.js (BSD-3-Clause).
- markdown-it 14.3.3: https://github.com/markdown-it/markdown-it (MIT).
- Zod 4.1.12: https://github.com/colinhacks/zod (MIT).
- Development tools include TypeScript, esbuild, tsx, VS Code packaging/types and Playwright Core; their original package notices apply.

The extension uses VS Code theme fonts and its own small SVG mark. Provider marks for OpenRouter, Cloudflare, Groq, Google Gemini, Cohere, and Vercel are bundled from [Lobe Icons static SVG 1.93.0](https://www.npmjs.com/package/@lobehub/icons-static-svg/v/1.93.0) for provider identification. The marks belong to their respective owners.
