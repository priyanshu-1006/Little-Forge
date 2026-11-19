# Little Forge product site

This is the standalone React, Vite and Tailwind CSS website. It includes local shadcn-style components built on Radix, a downloadable VSIX, seven documentation pages with search, three short workflow videos, and the full narrated demo with English captions.

## Run locally

Use Node.js 22.14 or newer. From the repository root:

```sh
cd website
npm ci
npm run dev
```

Run `npm run build` to type-check and build the production site. Run `npm run preview` to check the built files locally.

## Deploy on Vercel

1. Import your Git repository into Vercel.
2. Select `website` as the Root Directory and use the Vite framework preset.
3. Keep `npm ci` as the Install Command, `npm run build` as the Build Command, and `dist` as the Output Directory. The checked-in `vercel.json` supplies the same values and rewrites for documentation and download routes.
4. After deployment, open `/docs/installation` directly, download the VSIX from `/download`, and play the narrated demo on the home page.

The site uses static files and requires no environment variables. The local TrueForge harness is part of the downloaded extension's workflow and runs on the visitor's computer.

## Update release assets

- `src/data/release.json` provides the version, compatibility requirements, filename, file size, and SHA-256 shown by the site. Keep it in sync with the VSIX in `public/downloads/`.
- `public/media/` holds the narrated MP4, captions, posters, and optimized muted clips. The chapters are defined in `src/data/product.ts`.
- `src/data/documentation.ts` holds the docs in structured sections. The search index is generated from that content in the browser.
- `public/brand/` holds the supplied Little Forge mark and existing provider icons.

## Artwork

`public/brand/forge-laptop.webp` and `public/brand/forge-studio.webp` were created with the built-in image generation tool and optimized for the site. The homepage places the real VS Code recording still inside the laptop's screen. The studio artwork appears on the download page.

> Use case: product-mockup. Asset type: isolated hero product photograph for the Little Forge website. Generate one premium slim open laptop in matte deep graphite and subtle violet-black anodized aluminum. Landscape composition, centered horizontally and vertically, entire laptop and its shadow in the frame with a little clear margin. The screen is the dominant subject: exactly straight-on toward a centered camera, level, vertical rectangular plane, symmetrical, four sharp level unambiguous screen corners, 16:9 inner display, thin dark bezels. Camera at screen mid-height with a long lens, rectilinear perspective, just enough view of the low keyboard deck and trackpad below the screen to immediately identify a real laptop. The base should extend for a short elegant foreground, not be hidden or tall. Clean hard-surface industrial design, real studio materials, restrained soft lavender edge lighting and a very subtle grounding shadow. The internal display must be a single perfectly uniform flat light neutral lavender-gray (#cac3d2) placeholder, fully blank and opaque, absolutely free of reflections, text, artwork, logos, or gradients. Real website screenshot will be added onto that clean display in CSS later. Do not show a composited interface. No brand logo or wordmarks anywhere, no props, no text. Genuine transparent background outside laptop and subtle grounding shadow, preserve alpha.

> Use case: stylized-concept. Asset type: landscape hero backdrop for Little Forge, a VS Code developer tool whose visual identity is violet and white. Create a premium editorial studio photograph of a single sculptural arrangement of overlapping polished pale-lavender optical glass and powder-coated obsidian architectural plates, angular beveled edges and softly radiused corners like bent pieces of a mechanical key. A very subtle cool purple light refracts through the glass onto a matte pale-periwinkle studio surface, with realistic directional shadows and tasteful fine texture. High-end hardware product shoot, deliberate industrial design, no sci-fi spectacle. Extra-wide composition 3:2 or wider. LEFT 52% is broad quiet uninterrupted near-uniform light lavender-gray negative space with soft lighting, intended for dark headline copy. The sculpture sits low on the RIGHT half, toward the lower-right edge, and blends gently into the pale background around the center. Color range #eeebf8, #ded5f6, #aa8cee, and deep #2b1a48 accents sparingly. The real editor screenshot will be layered above this asset in code. No text, no typography, no logos, no people, no computer interface, no glowing particles, no generic abstract gradients or swirly neon ribbons.

The built-in image generation tool also created `public/brand/forge-hero-light.webp`, the texture below the hero's CSS gradients, and `public/brand/forge-agent-light.webp`, the glass artwork behind the simulated editor.

> Use case: stylized-concept. Asset type: wide, understated texture for the hero of a modern VS Code extension website. Photograph the soft projected light from thick optical glass onto an empty finely textured warm-white studio paper surface, so the entire frame is abstract colored light with no identifiable object. Very pale apricot glow toward lower-left, muted periwinkle and lilac toward right, with a more saturated violet refracted caustic contained to the far lower-right edge. Wide landscape 3:2 or wider, most of the upper half quiet and diffused, slight fine analog grain, polished editorial art direction. Bright with no dark lines through the copy or subject area. The content is layered above this. No devices, no geometric render props, no lettering, no interface, no logos, no people, no graphic icons.

> Use case: stylized-concept. Asset type: subtle background art behind a dark coding-agent demo. Premium macro studio photograph of soft violet and warm amber light refracting through one beveled smoked optical-glass edge, on matte near-black aubergine. Landscape framing, low exposure, subject confined to lower right, quiet dark left, no bright highlights where text will sit. Fine tactile detail, deep shadow, light feels physical and understated. No screen, no text, no logos, no interface elements, no icon grid, no people. Output is an ambient lighting asset only.
