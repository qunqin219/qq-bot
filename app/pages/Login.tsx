import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { MessageCircleIcon, AlertCircleIcon } from '../../components/Icons'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.login(username, password)
      navigate('/')
      window.location.reload()
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)) || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen">
      {/* 左侧品牌区 */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-sidebar px-10 py-10 text-sidebar-foreground lg:flex">
        <div className="ops-noise absolute inset-0 opacity-60" />
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #0f766e 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-16 left-10 h-56 w-56 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #14b8a6 0%, transparent 70%)' }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-teal-50">
            <MessageCircleIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">QQ Bot</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/50">
              Ops Console
            </div>
          </div>
        </div>

        <div className="relative space-y-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-teal-300/80">
            Control Room
          </p>
          <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-white">
            管理连接、消息与 AI 运行时
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">
            监控 NapCat 链路、审查群白名单、排查日志与工具调用——一套运维台搞定。
          </p>
        </div>

        <p className="relative font-mono text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/40">
          OneBot 11 · NapCat · Local Panel
        </p>
      </div>

      {/* 右侧表单 */}
      <div className="ops-grid relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MessageCircleIcon className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">QQ Bot 运维台</h1>
            <p className="mt-1 text-sm text-muted-foreground">登录以继续管理</p>
          </div>

          <div className="mb-6 hidden lg:block">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
              Sign In
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              登录管理面板
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">使用面板账号进入运维控制台</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 rounded-md border border-border bg-card p-5">
            <div>
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                required
                autoFocus
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
                className="mt-1.5"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-start gap-2">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '登录中...' : '进入控制台'}
            </Button>
          </form>

          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Local Session · Same-Origin API
          </p>
        </div>
      </div>
    </div>
  )
}
