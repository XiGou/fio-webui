import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { LayoutDashboard, ClipboardList, History } from 'lucide-react'

export function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl space-y-5 p-6">
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
                <LayoutDashboard className="h-4 w-4" />
                任务
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
                历史
              </NavLink>
              <NavLink
                to="/presets"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <ClipboardList className="h-4 w-4" />
                预设负载
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
