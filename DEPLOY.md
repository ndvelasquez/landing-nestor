# Deploy

Hosting: Vercel, connected to the GitHub repo `ndvelasquez/landing-nestor`. Nothing is deployed until Nestor approves it.

## First deploy

1. Push the repo to GitHub (`ndvelasquez/landing-nestor`).
2. In Vercel: Add New, Project, import `ndvelasquez/landing-nestor`.
3. Vercel detects Astro. Check the settings:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
   - Node.js version: 22.x
4. Deploy. No environment variables are needed.
5. If the assigned URL differs from `https://nestorvelasquez.vercel.app`, update `site` in `astro.config.mjs`, remove the TODO comment and push again.

## After each change

Pushes to the main branch deploy to production. Other branches get preview URLs.

Before pushing, run locally:

```
npm run build
npm run preview
```

## Check after deploy

- Both routes load: `/` and `/work/ai-ticket-triage`
- `canonical`, `og:url` and `og:image` point to the production URL (view source)
- `/og.png`, `/favicon.ico`, `/apple-touch-icon.png` and `/Nestor_Velasquez_CV.pdf` return 200
- Share preview renders (LinkedIn Post Inspector)
