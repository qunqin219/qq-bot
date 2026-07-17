// 根组件 —— 路由配置 + 登录守卫
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { api } from '../lib/api/client'
import MainLayout from './layouts/MainLayout'
import Dashboard from './pages/Dashboard'
import Admins from './pages/Admins'
import Messages from './pages/Messages'
import SendMsg from './pages/SendMsg'
import Settings from './pages/Settings'
import Groups from './pages/Groups'
import Conversations from './pages/Conversations'
import Memories from './pages/Memories'
import Logs from './pages/Logs'
import Login from './pages/Login'
import Sandbox from './pages/Sandbox'

// ── 路由守卫：未登录时跳转到 /login ─────────────────────
function ProtectedRoute({ children, isAuthenticated, loading }: { children: ReactNode; isAuthenticated: boolean; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          <span className="font-mono text-xs tracking-wide">加载中...</span>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [auth, setAuth] = useState<{ checked: boolean; ok: boolean }>({ checked: false, ok: false })

  useEffect(() => {
    api.getMe()
      .then((data) => setAuth({ checked: true, ok: !!data.authenticated }))
      .catch(() => setAuth({ checked: true, ok: false }))
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <ProtectedRoute isAuthenticated={auth.ok} loading={!auth.checked}>
            <MainLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/admins" element={<Admins />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/memories" element={<Memories />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/send" element={<SendMsg />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/sandbox" element={<Sandbox />} />
              </Routes>
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
