import { NavLink, Outlet } from 'react-router-dom'
import { Activity, BarChart3, Boxes, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { to: '/', label: '编排', icon: Boxes, end: true },
  { to: '/monitor', label: '实时', icon: Activity },
  { to: '/history', label: '报告', icon: BarChart3 },
]

export function Layout() {
  return (
    <div className="app-shell bg-background">
      <aside className="app-rail">
        <div className="flex h-14 items-center gap-3 border-b border-border px-3 lg:justify-center lg:px-0" title="FIO WebUI">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-foreground text-background"><HardDrive className="h-4 w-4" /></span>
          <span className="text-sm font-semibold lg:hidden">FIO WebUI</span>
        </div>
        <nav className="flex flex-1 items-center gap-1 p-2 lg:flex-col lg:items-stretch lg:gap-2 lg:pt-3" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => cn('rail-link', isActive && 'is-active')}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-border py-3 text-center font-mono text-[9px] text-muted-foreground lg:block">FIO<br />LAB</div>
      </aside>
      <main className="min-h-0 min-w-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
