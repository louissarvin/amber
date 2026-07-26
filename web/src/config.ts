interface AppConfig {
  appName: string
  appDescription: string
  tagline: string
  links: {
    twitter: string
    github: string
    docs: string
    marketplace: string
    mcp: string
  }
  api: {
    baseUrl: string
  }
  pricing: {
    writeUsdt: string
    queryUsdt: string
    bulkUsdt: string
    sessionUsdt: string
    freeWrites: number
  }
  features: {
    smoothScroll: boolean
  }
}

const apiBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_API_URL as string | undefined)) ||
  'http://localhost:3700'

export const config: AppConfig = {
  appName: 'AMBER',
  appDescription:
    'Persistent portable memory for AI agents. Keyed by your on-chain identity.',
  tagline: 'Every memory, on-chain forever.',

  links: {
    twitter: 'https://x.com/search?q=%23OKXAI',
    github: '',
    docs: 'https://www.okx.ai/tutorial',
    marketplace: 'https://www.okx.ai/agents',
    mcp: `${apiBase.replace(/\/$/, '')}/mcp`,
  },

  api: {
    baseUrl: apiBase.replace(/\/$/, ''),
  },

  pricing: {
    writeUsdt: '0.001',
    queryUsdt: '0.0005',
    bulkUsdt: '0',
    sessionUsdt: '0.0002',
    freeWrites: 100,
  },

  features: {
    smoothScroll: true,
  },
}

export type Config = AppConfig
