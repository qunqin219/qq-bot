// 主布局：左侧运维侧栏 + 右侧内容区
import type { ReactNode, ComponentType, SVGProps } from 'react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../../lib/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  LayoutDashboardIcon,
  UsersIcon,
  MessagesSquareIcon,
  BrainIcon,
  PinIcon,
  ScrollTextIcon,
  SendIcon,
  SettingsIcon,
  LogOutIcon,
  MessageCircleIcon,
  ShieldIcon,
  MenuIcon,
  XIcon,
  FlaskConicalIcon,
} from '../../components/Icons'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  end?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: '概览',
    items: [{ to: '/', label: '仪表盘', icon: LayoutDashboardIcon, end: true }],
  },
  {
    title: '访问控制',
    items: [
      { to: '/admins', label: '管理员', icon: ShieldIcon },
      { to: '/groups', label: '群管理', icon: UsersIcon },
    ],
  },
  {
    title: '数据',
    items: [
      { to: '/messages', label: '消息', icon: MessagesSquareIcon },
      { to: '/conversations', label: '上下文', icon: BrainIcon },
      { to: '/memories', label: '记忆', icon: PinIcon },
    ],
  },
  {
    title: '运维',
    items: [
      { to: '/sandbox', label: 'QQ 沙盒', icon: FlaskConicalIcon },
      { to: '/send', label: '发消息', icon: SendIcon },
      { to: '/logs', label: '日志', icon: ScrollTextIcon },
      { to: '/settings', label: '设置', icon: SettingsIcon },
    ],
  },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {navGroups.map((group) => (
        <div key={group.title}>
          <div className="mb-1.5 px-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/45">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-muted hover:text-white'
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-80" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

export default function MainLayout({ children }: { children?: ReactNode }) {
  const [loggingOut, setLoggingOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const lockViewport = location.pathname === '/logs'

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // ignore
    } finally {
      window.location.href = '/login'
    }
  }

  const sidebar = (
    <aside className="flex h-full w-60 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-700 text-teal-50">
          <MessageCircleIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-white">QQ Bot</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
            运维控制台
          </div>
        </div>
      </div>

      <SidebarNav onNavigate={() => setMobileOpen(false)} />

      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-muted hover:text-white"
        >
          <LogOutIcon className="h-4 w-4" />
          {loggingOut ? '退出中...' : '退出登录'}
        </Button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* 桌面侧栏 */}
      <div className="hidden h-full shrink-0 lg:block">{sidebar}</div>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="关闭菜单"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 移动顶栏 */}
        <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-3 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            {mobileOpen ? <XIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
              <MessageCircleIcon className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">QQ Bot</span>
          </div>
        </header>

        <main
          className={cn(
            'ops-grid relative flex min-h-0 flex-1 flex-col',
            lockViewport ? 'overflow-hidden' : 'overflow-auto'
          )}
        >
          <div
            className={cn(
              'relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-6',
              lockViewport && 'min-h-0 overflow-hidden'
            )}
          >
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </div>
  )
}
