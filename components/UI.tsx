import type { ReactNode, ComponentType, SVGProps } from 'react'
import { Alert, AlertAction } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card as BaseCard } from '@/components/ui/card'
import { useToast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { AlertCircleIcon } from './Icons'

export { useToast }

export function Loading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      <span className="text-sm">{text}</span>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <AlertCircleIcon className="h-4 w-4 shrink-0" />
        <span>{message || '发生错误'}</span>
      </div>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <BaseCard className={cn('rounded-lg border border-border bg-card', className)}>
      {children}
    </BaseCard>
  )
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function PanelHeader({ title, description, meta, action, className = '' }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {meta && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {meta}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-[160px] flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className={cn('text-sm font-medium text-foreground', Icon && 'mt-3')}>
        {title}
      </div>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('space-y-4', className)}>{children}</section>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
}
