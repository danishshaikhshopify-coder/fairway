# Fairway CRM

Production CRM for golf simulator prospecting and sales operations across the USA, Canada, and Mexico.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first config, no `tailwind.config.js`)
- **shadcn/ui** (Base UI components, `components.json` → `src/components/ui/`)
- **Inter** via `next/font/google`
- **next-themes** — Light / Dark / System, class-based `.dark` variant
- **Supabase** (PostgreSQL + Auth + Row Level Security) — planned, Phase 2

## Requirements

- Node.js 20+ (developed on 24.x)
- npm (the lockfile is `package-lock.json` — use npm, not yarn/pnpm)

## Setup

```bash
npm ci                       # install exact versions from the lockfile
copy .env.example .env.local # Windows (macOS/Linux: cp .env.example .env.local)
npm run dev                  # http://localhost:3000
```

Environment variable **names** are listed in `.env.example`; real values live only in `.env.local` (gitignored).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |
| `npm run typecheck` | TypeScript, no emit |

## Project structure

```
src/
  app/
    layout.tsx        Root layout: Inter font, metadata, ThemeProvider
    page.tsx          Home route
    globals.css       Tailwind v4 theme + shadcn CSS variables (light/dark)
  components/
    theme-provider.tsx  next-themes wrapper (client component)
    ui/                 shadcn/ui components (button, card, dropdown-menu)
  lib/
    utils.ts          `cn()` class helper
components.json        shadcn/ui configuration
next.config.ts         Next config (cacheComponents, Tailwind Turbopack loader)
eslint.config.mjs      ESLint flat config
```

## Conventions

- Import alias: `@/*` → `src/*`
- Theming: use shadcn CSS variables (`bg-background`, `text-foreground`, …) so light/dark both work — avoid hardcoded hex colors.
- Component colors must come from `globals.css` tokens; `.dark` overrides them.
- Never commit secrets. `npm audit fix --force` is off-limits (it downgrades Next/ESLint).

## Roadmap

- **Phase 1 (current)** — foundation: scaffold, theming, shadcn/ui, tooling
- **Phase 2** — Supabase project, schema, migrations, RLS policies, auth
- **Phase 3+** — companies, prospects, pipeline, and sales operations features
