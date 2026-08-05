import * as React from 'react'
import { cn } from '@/lib/utils'

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

const tones: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-cyan-200 bg-cyan-50 text-cyan-800',
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold uppercase', tones[tone], className)}
      {...props}
    />
  )
}
