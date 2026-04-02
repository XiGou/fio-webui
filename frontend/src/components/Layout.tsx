import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Boxes, History, ListTree, MoonStar, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Layout() {
  const location = useLocation()
  const isStudioPage = location.pathname === '/'
  const [compactMode, setCompactMode] = useState<boolean>(() => localStorage.getItem('ui-density') === 'compact')

  useEffect(() => {
    document.documentElement.setAttribute('data-density', compactMode ? 'compact' : 'comfortable')
    localStorage.setItem('ui-density', compactMode ? 'compact' : 'comfortable')
  }, [compactMode])

  return (
    <div className="min-h-screen bg-background">
      <div className={cn('space-y-4 px-4 py-4', isStudioPage ? 'mx-auto w-full max-w-none' : 'container mx-auto max-w-7xl')}>
        <header className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">FIO WebUI</h1>
            <nav className="flex items-center gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <Boxes className="h-4 w-4" />
                工作流工作台
              </NavLink>
              <NavLink
                to="/legacy"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <ListTree className="h-4 w-4" />
                传统配置（Legacy）
              </NavLink>
              <NavLink
                to="/history"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <History className="h-4 w-4" />
                任务管理
              </NavLink>
            </nav>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setCompactMode((v) => !v)}
          >
            {compactMode ? <MoonStar className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {compactMode ? '紧凑模式' : '舒适模式'}
          </button>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
