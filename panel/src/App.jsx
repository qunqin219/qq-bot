// 根组件 —— 路由配置 + 登录守卫
import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { api } from './api/client.js'
import MainLayout from './layouts/MainLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admins from './pages/Admins.jsx'
import Messages from './pages/Messages.jsx'
import SendMsg from './pages/SendMsg.jsx'
import Settings from './pages/Settings.jsx'
import Groups from './pages/Groups.jsx'
import Conversations from './pages/Conversations.jsx'
import Memories from './pages/Memories.jsx'
import Logs from './pages/Logs.jsx'
import Login from './pages/Login.jsx'

// ── 路由守卫：未登录时跳转到 /login ─────────────────────
function ProtectedRoute({ children, isAuthenticated, loading }) {
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex items-center gap-3">
          <svg className="h-6 w-6 animate-spin text-sky-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [auth, setAuth] = useState({ checked: false, ok: false })

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
              </Routes>
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
