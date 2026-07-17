import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import type { SandboxMode, SandboxStateResponse } from '../../lib/shared/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  DataPanel,
  EmptyState,
  ErrorBox,
  Loading,
  MonoLabel,
  PageHeader,
  PanelHeader,
  StatusDot,
  useToast,
} from '../../components/UI'
import {
  FlaskConicalIcon,
  MessageCircleIcon,
  RefreshCwIcon,
  SendIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from '../../components/Icons'

const scenarios: Record<SandboxMode, Array<{ label: string; text: string; trigger: boolean }>> = {
  private: [
    { label: '能力探测', text: '介绍一下你现在能做什么，回答简短一点。', trigger: true },
    { label: '连续上下文', text: '记住测试代号是 Aurora，下一条我会问你。', trigger: true },
  ],
  group: [
    { label: '群聊垫话', text: '今晚九点发布，先检查回归测试。', trigger: false },
    { label: '成员查询', text: '帮我查一下这个群里有哪些成员。', trigger: true },
    { label: '管理工具', text: '确认禁言 QQ 99001002 10 分钟。', trigger: true },
  ],
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
}

function muted(member: SandboxStateResponse['group']['members'][number]): boolean {
  return Boolean(member.muted_until && new Date(member.muted_until).getTime() > Date.now())
}

export default function Sandbox() {
  const [state, setState] = useState<SandboxStateResponse | null>(null)
  const [mode, setMode] = useState<SandboxMode>('private')
  const [senderId, setSenderId] = useState('99001001')
  const [text, setText] = useState('')
  const [triggerAi, setTriggerAi] = useState(true)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const { success, error, ToastEl } = useToast()

  const fetchState = async () => {
    try {
      setLoadError('')
      setState(await api.getSandbox())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchState()
  }, [])

  const messages = state?.messages[mode] || []
  useEffect(() => {
    const node = timelineRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [mode, messages.length])

  const senders = useMemo(() => {
    if (!state) return []
    return state.group.members.filter((member) => member.user_id !== state.bot.user_id && !member.kicked)
  }, [state])

  useEffect(() => {
    if (mode === 'private' && state) setSenderId(String(state.private_peer.user_id))
    if (mode === 'group' && senders.length && !senders.some((member) => String(member.user_id) === senderId)) {
      setSenderId(String(senders[0].user_id))
    }
    setReplyTo(null)
  }, [mode, state, senders, senderId])

  const selectedReply = messages.find((message) => message.message_id === replyTo) || null

  const handleSend = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const result = await api.sendSandboxMessage({
        mode,
        text: text.trim(),
        sender_id: Number(senderId),
        reply_to: replyTo,
        trigger_ai: mode === 'private' ? true : triggerAi,
      })
      setState(result.state)
      setText('')
      setReplyTo(null)
      if (!result.reply) success(mode === 'group' && !triggerAi ? '群消息已写入模拟上下文' : '消息已送达沙盒')
    } catch (err) {
      error(err instanceof Error ? err.message : String(err))
      await fetchState()
    } finally {
      setSending(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const result = await api.resetSandbox()
      setState(result.state)
      setReplyTo(null)
      setText('')
      setSenderId('99001001')
      success('沙盒消息和群状态已重置')
    } catch (err) {
      error(err instanceof Error ? err.message : String(err))
    } finally {
      setResetting(false)
    }
  }

  if (loading) return <Loading text="正在初始化 QQ 沙盒..." />
  if (!state) return <ErrorBox message={loadError || '沙盒加载失败'} onRetry={fetchState} />

  return (
    <div>
      <PageHeader
        title="QQ Agent 沙盒"
        subtitle="内存态 QQ 仿真 · 私聊 / 群聊 · 不连接 NapCat"
        action={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 border-status-ok/30 text-status-ok">
              <StatusDot ok label="isolated" />
            </Badge>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting || sending}>
              <RefreshCwIcon className={cn('h-4 w-4', resetting && 'animate-spin')} />
              重置沙盒
            </Button>
          </div>
        }
      />
      {ToastEl}

      <DataPanel className="grid min-h-[650px] xl:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="border-b border-border bg-secondary/20 xl:border-b-0 xl:border-r">
          <PanelHeader title="Channels" meta="2 virtual" description="会话相互隔离" />
          <div className="p-2">
            <button
              type="button"
              onClick={() => setMode('private')}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors',
                mode === 'private' ? 'border-primary/35 bg-primary/8' : 'border-transparent hover:bg-muted/60'
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded bg-teal-700 text-white"><UserIcon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">林澈</span>
                <span className="block font-mono text-[10px] text-muted-foreground">PRIVATE · {state.messages.private.length}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('group')}
              className={cn(
                'mt-1 flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors',
                mode === 'group' ? 'border-primary/35 bg-primary/8' : 'border-transparent hover:bg-muted/60'
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-white"><UsersIcon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">Agent 沙盒测试群</span>
                <span className="block font-mono text-[10px] text-muted-foreground">GROUP · {state.messages.group.length}</span>
              </span>
            </button>
          </div>

          <div className="border-t border-border px-3 py-3">
            <MonoLabel>Quick scenarios</MonoLabel>
            <div className="mt-2 space-y-1.5">
              {scenarios[mode].map((scenario) => (
                <button
                  key={scenario.label}
                  type="button"
                  onClick={() => {
                    setText(scenario.text)
                    setTriggerAi(scenario.trigger)
                  }}
                  className="w-full rounded border border-border bg-card px-2.5 py-2 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <span className="block font-medium text-foreground">{scenario.label}</span>
                  <span className="mt-0.5 line-clamp-2 block">{scenario.text}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-h-[650px] min-w-0 flex-col">
          <PanelHeader
            title={mode === 'private' ? 'Private link' : 'Group channel'}
            meta={mode === 'private' ? state.private_peer.user_id : state.group.group_id}
            description={mode === 'private' ? '管理员私聊 Agent Bot' : '@Bot 触发，或只写入群聊背景'}
          />

          <div ref={timelineRef} className="min-h-0 flex-1 overflow-y-auto bg-background/35 px-3 py-4 sm:px-5">
            {messages.length === 0 ? (
              <EmptyState
                icon={MessageCircleIcon}
                title="等待第一条模拟消息"
                description={mode === 'private' ? '私聊会直接调用 Agent。' : '可以先发送几条不触发 Bot 的群聊消息，再测试上下文理解。'}
                className="h-full min-h-[300px]"
              />
            ) : (
              <div className="space-y-4">
                {messages.map((message) => {
                  const quoted = message.reply_to
                    ? messages.find((item) => item.message_id === message.reply_to)
                    : null
                  return (
                    <article key={message.id} className={cn('flex gap-2.5', message.from_bot && 'flex-row-reverse')}>
                      <div className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold text-white',
                        message.from_bot ? 'bg-teal-700' : message.sender_role === 'owner' ? 'bg-amber-700' : 'bg-slate-600'
                      )}>
                        {message.from_bot ? 'BOT' : message.sender_name.slice(0, 1)}
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTo(message.message_id)}
                        className={cn('group max-w-[82%] text-left', message.from_bot && 'text-right')}
                        title="引用这条消息"
                      >
                        <div className={cn('mb-1 flex items-center gap-2', message.from_bot && 'justify-end')}>
                          <span className="text-xs font-medium">{message.sender_name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">#{message.message_id} · {formatTime(message.created_at)}</span>
                        </div>
                        <div className={cn(
                          'rounded-md border px-3 py-2.5 text-sm leading-relaxed shadow-sm transition-colors group-hover:border-primary/35',
                          message.from_bot ? 'border-teal-700/25 bg-teal-50 text-slate-900' : 'border-border bg-card text-foreground'
                        )}>
                          {quoted && (
                            <div className="mb-2 border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                              {quoted.sender_name}：{quoted.text.slice(0, 100)}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap break-words">{message.text}</p>
                          {message.run_id && (
                            <div className="mt-2 border-t border-current/10 pt-1.5 font-mono text-[9px] uppercase tracking-wide opacity-55">
                              {message.agent || 'agent'} · run {message.run_id.slice(0, 8)}
                            </div>
                          )}
                        </div>
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="border-t border-border bg-card">
            {selectedReply && (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/35 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">引用 #{selectedReply.message_id} · {selectedReply.sender_name}：{selectedReply.text}</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setReplyTo(null)} aria-label="取消引用">
                  <XIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
              }}
              placeholder={mode === 'private' ? '向 Agent Bot 发送私聊…' : '输入模拟群消息…'}
              className="min-h-[96px] resize-none rounded-none border-0 bg-transparent focus:ring-0"
            />
            <div className="flex flex-col gap-3 border-t border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {mode === 'group' && (
                  <Select
                    value={senderId}
                    onValueChange={setSenderId}
                    options={senders.map((member) => ({
                      value: String(member.user_id),
                      label: `${member.card || member.nickname} · ${member.role}`,
                    }))}
                    className="h-8 w-[190px] font-mono text-xs"
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={mode === 'private' ? true : triggerAi} disabled={mode === 'private'} onCheckedChange={setTriggerAi} />
                  {mode === 'private' ? '调用 Agent' : triggerAi ? '@Bot 并调用 Agent' : '仅写入群聊上下文'}
                </label>
              </div>
              <div className="flex items-center justify-end gap-3">
                <span className="font-mono text-[10px] text-muted-foreground">⌘ ↵ · {text.length}/8000</span>
                <Button type="submit" disabled={sending || !text.trim() || text.length > 8000}>
                  {sending ? <><RefreshCwIcon className="h-4 w-4 animate-spin" /> Agent 运行中</> : <><SendIcon className="h-4 w-4" /> 发送</>}
                </Button>
              </div>
            </div>
          </form>
        </section>

        <aside className="border-t border-border bg-secondary/15 xl:border-l xl:border-t-0">
          <PanelHeader title="Environment" description="运行时与模拟状态" />
          <div className="grid grid-cols-2 border-b border-border xl:grid-cols-1">
            <div className="border-b border-r border-border px-3 py-2.5 xl:border-r-0">
              <MonoLabel>Transport</MonoLabel>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium"><StatusDot ok /> Memory OneBot</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">NAPCAT: DISCONNECTED BY DESIGN</div>
            </div>
            <div className="border-b border-border px-3 py-2.5">
              <MonoLabel>Model runtime</MonoLabel>
              <div className="mt-1 truncate text-sm font-medium">{state.provider} / {state.model || 'default'}</div>
              <div className={cn('mt-0.5 font-mono text-[10px]', state.ai_configured ? 'text-status-ok' : 'text-status-err')}>
                {state.ai_configured ? 'API KEY READY' : 'API KEY REQUIRED'}
              </div>
            </div>
          </div>

          <PanelHeader title="Simulated group" meta={`${state.group.members.filter((member) => !member.kicked).length} active`} />
          <div className="border-b border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">全员禁言</span>
              <Badge variant={state.group.whole_ban ? 'destructive' : 'secondary'}>{state.group.whole_ban ? 'ON' : 'OFF'}</Badge>
            </div>
          </div>
          <div className="divide-y divide-border">
            {state.group.members.map((member) => (
              <div key={member.user_id} className={cn('px-3 py-2.5', member.kicked && 'opacity-45')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{member.card || member.nickname}</span>
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>{member.role}</Badge>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>{member.user_id}</span>
                  <span className={cn((muted(member) || member.kicked) && 'text-status-err')}>
                    {member.kicked ? 'KICKED' : muted(member) ? 'MUTED' : 'ACTIVE'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {!state.ai_configured && (
            <div className="m-3 rounded-md border border-amber-400/35 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              请先在“设置 → AI”配置 Provider 与 API Key。沙盒本身不会保存凭证。
            </div>
          )}
          <div className="m-3 rounded-md border border-dashed border-border bg-card/60 p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><FlaskConicalIcon className="h-3.5 w-3.5 text-primary" /> 隔离保证</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">刷新或重启服务不会向真实 QQ 发送消息。群工具只改变右侧这份模拟成员状态。</p>
          </div>
        </aside>
      </DataPanel>
    </div>
  )
}
