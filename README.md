<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8ef658e2-3df5-4eae-a9ef-66cc242351cd

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy on Cloudflare Workers

This repo uses Cloudflare Workers with static assets for the Vite app and a Worker entrypoint for the backend API routes.

Use these Workers build settings:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` or `npx wrangler versions upload`
- Root directory: `/`
- Node version: `22`

Add this Cloudflare Worker secret:

- `GEMINI_API_KEY`: your Gemini API key
- `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service role key

The frontend calls `/api/extract`, `/api/validate-phone`, and `/api/db/*` on the same Worker domain, so no separate backend URL is required.
