# Nestor David Velasquez — Portfolio Landing Page

Portfolio site for **Nestor David Velasquez**, Automation-first Product Support Engineer specializing in SaaS FP&A, data conversions, and workflow automation.

**Live Demo:** [Deploy on Vercel](https://vercel.com) *(pending deployment)*

---

## 🎨 Brand Guidelines

This project follows the **SmartNest Solutions** brand manual:

| Color | Hex | Usage |
|-------|-----|-------|
| Ink (Primary Dark) | `#101820` | Text, backgrounds |
| Deep Teal | `#00313C` | Primary accents, CTAs |
| Glow Cyan | `#9ADBE8` | Highlights, icons, borders |
| Surface | `#F4F6F8` | Light backgrounds (light mode) |

**Typography:** Nunito (Google Fonts) — weights 400, 600, 700

**Visual Style:** Dark theme by default, glassmorphism cards, fluid microinteractions, minimal aesthetic.

---

## 🚀 Project Structure

```
landing/
├── public/
│   ├── assets/
│   │   └── icons/          # Generated icons (Nano Banana Pro)
│   │       ├── data.png
│   │       ├── flow.png
│   │       └── support.png
│   ├── Nestor_Velasquez_CV.pdf
│   └── favicon.ico
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro   # Global styles, theme config
│   └── pages/
│       └── index.astro        # Main landing page
├── dist/                      # Production build output
├── package.json
├── astro.config.mjs
└── tsconfig.json
```

---

## 🛠 Tech Stack

- **Framework:** Astro 6.x (static site generation)
- **Language:** TypeScript
- **Styling:** Inline CSS with CSS custom properties (brand tokens)
- **Icons:** Custom-generated via Nano Banana Pro (brand colors)
- **Hosting:** Vercel-ready (static output)

---

## 📦 Commands

| Command | Action |
|---------|--------|
| `npm install` | Install dependencies |
| `npm run dev` | Start local dev server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview production build locally |

---

## 🚀 Deployment

### Vercel (Recommended)

1. Push code to GitHub (this repo)
2. Import project in Vercel Dashboard
3. Select this repo and deploy
4. Vercel auto-detects Astro and deploys

**Environment Variables:** None required (static site)

### Manual Build

```bash
npm install
npm run build
# Upload ./dist to any static host (Netlify, Cloudflare Pages, etc.)
```

---

## 📄 Content Sections

1. **Hero** — Value proposition + CTAs (WhatsApp, LinkedIn, CV download)
2. **Capabilities** — Core skills in automation & support
3. **Automation Highlights** — Three key service areas with custom icons
4. **Journey** — Timeline of professional experience
5. **CTA** — Final call-to-action for collaboration

---

## 🎯 Goals

- Showcase Nestor's expertise in **data conversions**, **ETL automation**, and **SaaS FP&A support**
- Provide direct contact paths (WhatsApp, LinkedIn) — no contact forms
- ATS-friendly CV download
- Fast, accessible, SEO-friendly static site
- Git-versioned for easy updates

---

## 📝 License

Personal portfolio — all rights reserved.

---

**Built with** ❤️ **by Nelson (OpenClaw AI Assistant)**
