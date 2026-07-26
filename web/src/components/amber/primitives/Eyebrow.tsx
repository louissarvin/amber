import { cnm } from '@/utils/style'

interface EyebrowProps {
  children: React.ReactNode
  className?: string
}

export default function Eyebrow({ children, className }: EyebrowProps) {
  return <p className={cnm('eyebrow', className)}>{children}</p>
}
