import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import HeroUIProvider from '../providers/HeroUIProvider'
import LenisSmoothScrollProvider from '../providers/LenisSmoothScrollProvider'
import ErrorPage from '../components/ErrorPage'
import Navbar from '../components/amber/Navbar'
import Footer from '../components/amber/Footer'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import { config } from '@/config'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => (
    <ErrorPage error={error} reset={reset} />
  ),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: `${config.appName} — ${config.tagline}` },
      { name: 'description', content: config.appDescription },
      { name: 'theme-color', content: '#0A0A0A' },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/assets/logo-index.svg',
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg antialiased">
        <HeroUIProvider>
          <LenisSmoothScrollProvider />
          <div className="flex min-h-screen flex-col bg-bg text-fg">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </HeroUIProvider>
        <Scripts />
      </body>
    </html>
  )
}
