import { createFileRoute } from '@tanstack/react-router'
import AmberLanding from '@/components/amber/AmberLanding'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  return <AmberLanding />
}
