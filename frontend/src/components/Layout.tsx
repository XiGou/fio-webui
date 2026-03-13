import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Boxes, History, ListTree } from 'lucide-react'

export function Layout() {
  const location = useLocation()
  const isStudioPage = location.pathname === '/'

  return (
    <div className="min-h-screen bg-background">
      <div className={cn('space-y-5 px-3 py-4', isStudioPage ? 'mx-auto w-full max-w-none' : 'container mx-auto max-w-7xl p-6')}>
        <header className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-6">
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
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
