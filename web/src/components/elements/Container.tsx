import { cnm } from '@/utils/style'

interface ContainerProps {
  className?: string
  children: React.ReactNode
}

export default function Container({ className, children }: ContainerProps) {
  return (
    <div
      className={cnm('mx-auto w-full max-w-[1200px] px-6 md:px-12', className)}
    >
      {children}
    </div>
  )
}
