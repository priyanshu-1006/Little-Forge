# Third-party notices

The production build generates `dist/THIRD_PARTY_NOTICES.txt` from the packages actually included in the bundle, preserving available licence and notice text. That file is included in the VSIX. Legal comments remain in the bundle.

Principal dependencies:

- TrueForge harness 0.180.1: https://github.com/truefoundry/trueforge (MIT; separately installed development/local runtime).
- Model Context Protocol TypeScript SDK 1.26.0: https://github.com/modelcontextprotocol/typescript-sdk (MIT).
- jsdiff 8.0.2: https://github.com/kpdecker/jsdiff (BSD-3-Clause).
- ignore 7.0.5: https://github.com/kaelzhang/node-ignore (MIT).
- Zod 4.1.12: https://github.com/colinhacks/zod (MIT).
- Development tools include TypeScript, esbuild, tsx, VS Code packaging/types and Playwright Core; their original package notices apply.

The extension uses VS Code theme fonts and its own small SVG mark. No parent desktop assets, bundled fonts or external images are redistributed.
