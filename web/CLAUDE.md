# CLAUDE.md

You are a senior staff web engineer with a philosophy of dead simplicity, attention to detail, critical thinking, and robustness.

This repo is simple minded - no overengineering, no code poison, no early abstraction, no excessive comments, and no bloat.

---

## Project Overview

This is the **Kwek Labs Web Starter** - a production-ready React web application template built with modern tooling. It's designed as a starting point for new web projects with a focus on performance, developer experience, and clean architecture.

## Tech Stack

- **Framework**: TanStack Start (React 19 meta-framework)
- **Routing**: TanStack Router (file-based routing)
- **State/Data**: TanStack Query for server state
- **Styling**: Tailwind CSS 4 + HeroUI component library
- **Animations**: GSAP + Lenis smooth scroll
- **Build**: Vite 7 + Nitro
- **Language**: TypeScript (strict mode)
- **Package Manager**: bun

## Project Structure

```
src/
├── components/           # Shared components
│   └── elements/         # Reusable UI elements (AnimateComponent, etc.)
├── routes/               # File-based routes (TanStack Router)
│   ├── __root.tsx        # Root layout, providers, meta tags
│   ├── index.tsx         # Home page
│   └── demo/             # Demo routes
├── providers/            # React context providers
│   ├── HeroUIProvider.tsx
│   └── LenisSmoothScrollProvider.tsx
├── hooks/                # Custom React hooks
├── utils/                # Pure helper functions
│   ├── style.ts          # cnm() - clsx + tailwind-merge
│   └── format.ts         # Number/string formatting utilities
├── lib/                  # External integrations (APIs, contracts)
├── integrations/         # Framework integrations
├── data/                 # Static/mock data
├── config.ts             # App configuration constants
├── router.tsx            # Router setup
└── styles.css            # Global styles
```

## Key Files

| File | Purpose |
|------|---------|
| `src/config.ts` | App-wide configuration (links, feature flags) |
| `src/routes/__root.tsx` | Root layout with providers and meta tags |
| `src/components/elements/AnimateComponent.tsx` | GSAP-powered scroll animations |
| `src/components/WebstarterOnboarding.tsx` | Starter template landing page |
| `src/utils/style.ts` | `cnm()` utility for className merging |
| `src/utils/format.ts` | Number/currency/date formatting |

## Commands

```bash
bun dev        # Start dev server on port 3200
bun build      # Production build
bun preview    # Preview production build
bun lint       # Run ESLint
bun format     # Run Prettier
bun check      # Format + lint fix
bun test       # Run Vitest tests
```

## Development Guidelines

### Component Organization

1. **Use AnimateComponent for scroll animations**
   ```tsx
   <AnimateComponent onScroll entry="fadeInUp" delay={200}>
     <YourContent />
   </AnimateComponent>
   ```

2. **Use cnm() for conditional classes**
   ```tsx
   import { cnm } from '@/utils/style'

   <div className={cnm(
     'base-classes',
     isActive && 'active-classes',
     variant === 'primary' && 'primary-classes'
   )} />
   ```

3. **Use HeroUI components for UI**
   ```tsx
   import { Button, Input, Modal } from '@heroui/react'
   ```

### Routing (TanStack Router)

- Routes are file-based in `src/routes/`
- Use `createFileRoute` for page components
- Root layout is in `__root.tsx`
- Nested routes use folder structure: `routes/dashboard/settings.tsx` → `/dashboard/settings`

### Styling

- **Tailwind CSS 4** - use `@import "tailwindcss"` syntax
- **Dark theme by default** - neutral color palette
- **Inter Variable font** - imported globally
- Custom scrollbar and selection styles in `styles.css`

### Data Fetching

- Use **TanStack Query** for server state
- Query client is set up in `src/integrations/tanstack-query/`
- Access via `useQuery`, `useMutation` hooks

### Animations

- **GSAP** for complex animations (AnimateComponent)
- **Lenis** for smooth scrolling (auto-initialized in root)
- **Framer Motion** available for component animations

## Code Style

- **TypeScript strict mode** enabled
- **ESLint + Prettier** for formatting
- Import aliases: `@/` maps to `src/`
- No barrel files - import directly from source files
- Keep components focused - extract when reused 2+ times

## Adding New Features

1. **New route**: Create file in `src/routes/` (e.g., `about.tsx` for `/about`)
2. **New component**: Add to `src/components/` (or `elements/` if generic)
3. **New utility**: Add to `src/utils/`
4. **New hook**: Add to `src/hooks/`
5. **API integration**: Add to `src/lib/`

## Common Patterns

### Page with animations
```tsx
import { createFileRoute } from '@tanstack/react-router'
import AnimateComponent from '@/components/elements/AnimateComponent'

export const Route = createFileRoute('/example')({ component: ExamplePage })

function ExamplePage() {
  return (
    <div className="min-h-screen bg-neutral-900">
      <AnimateComponent>
        <h1>Title</h1>
      </AnimateComponent>
      <AnimateComponent onScroll delay={100}>
        <p>Content that animates on scroll</p>
      </AnimateComponent>
    </div>
  )
}
```

### Data fetching
```tsx
import { useQuery } from '@tanstack/react-query'

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ['items'],
    queryFn: () => fetch('/api/items').then(r => r.json()),
  })

  if (isLoading) return <div>Loading...</div>
  return <div>{data.map(...)}</div>
}
```

## Deployment

- **Vercel**: Just push to main branch (vercel.json configured)
- **Other platforms**: Run `bun build` and deploy `.output/` directory

## Important Notes

- This uses **TanStack Start** (SSR-capable), not plain Vite React
- HeroUI requires the `dark` class on `<html>` for dark mode (already set)
- GSAP is the free version (not Shockingly) - all features available
- Lenis smooth scroll is initialized globally in root layout
