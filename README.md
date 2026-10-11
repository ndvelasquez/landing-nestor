# landing-nestor

Landing page and case study for Nestor Velasquez, Zendesk Support Ops Automation for SaaS and ecommerce teams.

## Stack

- Astro 6, static output, no client-side JavaScript
- Plain CSS. Every color, type size, space step and radius is a CSS variable in `src/styles/tokens.css`, a 1:1 mirror of `brand/tokens.json` in the freelancer project. Do not add color values anywhere else.
- Fonts: Gloock and Schibsted Grotesk from Google Fonts

## Structure

- `src/pages/index.astro`: home
- `src/pages/work/ai-ticket-triage.astro`: case study of the triage demo
- `src/layouts/Site.astro`: head (SEO, Open Graph, JSON-LD), header, footer
- `src/components/`: `EvidenceCard` (hero ticket), `Icon` (inline SVG icons)
- `public/`: favicons, `og.png`, workflow screenshot, CV

## Commands

```
npm install
npm run dev      # local server at http://localhost:4321
npm run build    # static site in dist/
npm run preview  # serve dist/ locally
```

Requires Node 22.12 or newer.

## Notes

- `site` in `astro.config.mjs` is the planned Vercel URL. Confirm it when the Vercel project exists; canonical and Open Graph URLs depend on it.
- `public/favicon.svg` repeats two token colors as literal values because an SVG favicon cannot read CSS variables. If the mark or ink color changes, update it and regenerate `favicon.ico` and `apple-touch-icon.png`.

Deploy: see `DEPLOY.md`.
