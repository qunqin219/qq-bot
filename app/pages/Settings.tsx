// 设置 —— 左侧分节导航 + 右侧表单面板
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../../lib/api/client'
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeSystemPrompt,
} from '../../lib/shared/system-prompt'
import {
  Loading,
  ErrorBox,
  PageHeader,
  DataPanel,
  PanelHeader,
  FieldRow,
  useToast,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { AlertCircleIcon, BrainIcon, CheckCircleIcon, RefreshCwIcon, SaveIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
import type { ConfigResponse } from '../../lib/shared/types'

type Cfg = ConfigResponse & Record<string, unknown>

type SectionId = 'basic' | 'ai-toggle' | 'ai-context' | 'ai-model' | 'ai-prompt'

const sections: { id: SectionId; label: string; group: string }[] = [
  { id: 'basic', label: '基础连接', group: '核心' },
  { id: 'ai-toggle', label: '开关与记忆', group: 'AI' },
  { id: 'ai-context', label: '上下文与引用', group: 'AI' },
  { id: 'ai-model', label: '工具与模型', group: 'AI' },
  { id: 'ai-prompt', label: '系统提示词', group: 'AI' },
]

export default function Settings() {
  const [cfg, setCfg] = useState<Cfg>(null as unknown as Cfg)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [section, setSection] = useState<SectionId>('basic')
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getConfig()
      setCfg({
        ...data,
        ai_system_prompt: normalizeSystemPrompt(data.ai_system_prompt),
        ai_api_key: '',
        ai_api_key_clear: false,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleSaveBasic = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateConfig({
        command_prefix: cfg.command_prefix,
        napcat_ws: cfg.napcat_ws,
      })
      success('基础设置已保存')
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAi = async (e?: FormEvent) => {
    e?.preventDefault()
    setSavingAi(true)
    try {
      const baseUrl = String(cfg.ai_base_url || '').trim()
      try {
        const parsed = new URL(baseUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('bad protocol')
        }
      } catch {
        throw new Error('API Base URL 必须是完整的 http(s) 地址，当前值看起来像被浏览器自动填充污染了')
      }
      const payload: Record<string, unknown> = {
        ai_enabled: cfg.ai_enabled ?? false,
        ai_provider: cfg.ai_provider || 'gemini',
        ai_base_url: baseUrl,
        ai_model: cfg.ai_model,
        ai_system_prompt: cfg.ai_system_prompt,
        ai_context_enabled: cfg.ai_context_enabled ?? true,
        ai_context_turns: Number(cfg.ai_context_turns || 10),
        ai_thinking_enabled: cfg.ai_thinking_enabled ?? true,
        ai_thinking_level: cfg.ai_thinking_level || 'medium',
        ai_google_search_enabled: cfg.ai_google_search_enabled ?? false,
        ai_url_context_enabled: cfg.ai_url_context_enabled ?? false,
        ai_web_search_enabled: cfg.ai_web_search_enabled ?? false,
        ai_web_search_context_size: cfg.ai_web_search_context_size || 'medium',
        ai_web_fetch_enabled: cfg.ai_web_fetch_enabled ?? false,
        ai_allow_group_mention_from_non_admin:
          cfg.ai_allow_group_mention_from_non_admin ?? false,
        ai_group_context_enabled: cfg.ai_group_context_enabled ?? true,
        ai_group_context_messages: Number(cfg.ai_group_context_messages || 20),
        ai_group_context_include_quote: cfg.ai_group_context_include_quote ?? true,
        ai_group_context_exclude_bot: cfg.ai_group_context_exclude_bot ?? true,
        ai_filter_stickers: cfg.ai_filter_stickers ?? true,
        ai_group_reply_quote_enabled: cfg.ai_group_reply_quote_enabled ?? true,
        ai_group_reply_quote_prefer_quoted:
          cfg.ai_group_reply_quote_prefer_quoted ?? true,
        ai_memory_enabled: cfg.ai_memory_enabled ?? true,
      }
      const nextApiKey = String(cfg.ai_api_key || '').trim()
      if (nextApiKey) payload.ai_api_key = nextApiKey
      if (cfg.ai_api_key_clear === true) payload.ai_api_key_clear = true
      const resp = await api.updateConfig(payload)
      if (resp?.config) {
        setCfg({ ...(resp.config as Record<string, unknown>), ai_api_key: '', ai_api_key_clear: false } as unknown as Cfg)
      }
      success('AI 配置已保存')
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingAi(false)
    }
  }

  if (loading) return <Loading text="加载设置..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  const systemPromptValue = cfg.ai_system_prompt ?? DEFAULT_AI_SYSTEM_PROMPT
  const systemPromptLines = systemPromptValue.split(/\r?\n/).length
  const systemPromptChars = systemPromptValue.length
  const aiProvider = String(cfg.ai_provider || 'gemini')
  const isOpenAI = aiProvider === 'openai'

  const handleProviderChange = (provider: string) => {
    if (provider === aiProvider) return
    if (provider === 'openai') {
      setCfg({
        ...cfg,
        ai_provider: 'openai',
        ai_base_url: 'https://api.openai.com/v1',
        ai_model: 'gpt-5.6-sol',
        ai_thinking_level: 'medium',
      })
      return
    }
    setCfg({
      ...cfg,
      ai_provider: 'gemini',
      ai_base_url: 'https://generativelanguage.googleapis.com/v1beta',
      ai_model: 'gemini-3.5-flash',
      ai_thinking_level: 'medium',
    })
  }

  let lastGroup = ''
  const nav = sections.map((s) => {
    const showGroup = s.group !== lastGroup
    lastGroup = s.group
    return (
      <div key={s.id}>
        {showGroup && (
          <div className="mb-1 mt-3 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground first:mt-0">
            {s.group}
          </div>
        )}
        <button
          type="button"
          onClick={() => setSection(s.id)}
          className={cn(
            'flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-muted/50',
            section === s.id && 'bg-teal-50 font-medium text-teal-900'
          )}
        >
          {s.label}
        </button>
      </div>
    )
  })

  let body: ReactNode

  if (section === 'basic') {
    body = (
      <form onSubmit={handleSaveBasic}>
        <PanelHeader title="基础" description="命令前缀与 NapCat 连接" />
        <FieldRow label="命令前缀" description="以此前缀开头的消息会被当作命令（如 /ping）。">
          <Input
            type="text"
            value={cfg.command_prefix ?? '/'}
            onChange={(e) => setCfg({ ...cfg, command_prefix: e.target.value })}
            placeholder="/"
            className="h-9"
          />
        </FieldRow>
        <FieldRow label="NapCat 连接地址" description="修改后需重启 Bot 生效。">
          <Input
            type="text"
            value={cfg.napcat_ws ?? 'ws://127.0.0.1:3001'}
            onChange={(e) => setCfg({ ...cfg, napcat_ws: e.target.value })}
            placeholder="ws://127.0.0.1:3001"
            className="h-9 font-mono text-sm"
          />
        </FieldRow>
        <div className="p-3">
          <Button type="submit" disabled={saving} className="w-full sm:w-auto">
            {saving ? '保存中...' : <><SaveIcon className="h-4 w-4" /> 保存基础设置</>}
          </Button>
        </div>
      </form>
    )
  } else if (section === 'ai-toggle') {
    body = (
      <form onSubmit={handleSaveAi}>
        <PanelHeader title="开关" description="总开关与记忆策略" />
        <FieldRow label="启用 AI 回复" description="开启后使用已选择的模型 Provider 生成回复。">
          <Switch checked={cfg.ai_enabled ?? false} onCheckedChange={(v) => setCfg({ ...cfg, ai_enabled: v })} />
        </FieldRow>
        <FieldRow label="启用个性化记忆" description="模型可按会话独立创建、更新和删除记忆。">
          <Switch checked={cfg.ai_memory_enabled ?? true} onCheckedChange={(v) => setCfg({ ...cfg, ai_memory_enabled: v })} />
        </FieldRow>
        <FieldRow label="允许群成员 @Bot 触发" description="非管理员在允许的群里 @Bot 也可触发 AI。">
          <Switch
            checked={cfg.ai_allow_group_mention_from_non_admin ?? false}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_allow_group_mention_from_non_admin: v })}
          />
        </FieldRow>
        <FieldRow label="过滤表情包" description="群上下文跳过动画表情；单独表情包不触发 AI。">
          <Switch checked={cfg.ai_filter_stickers ?? true} onCheckedChange={(v) => setCfg({ ...cfg, ai_filter_stickers: v })} />
        </FieldRow>
        <div className="p-3">
          <Button type="submit" disabled={savingAi}>
            {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
          </Button>
        </div>
      </form>
    )
  } else if (section === 'ai-context') {
    body = (
      <form onSubmit={handleSaveAi}>
        <PanelHeader title="上下文" description="会话历史与群聊引用" />
        <FieldRow label="启用上下文记忆" description="每个私聊和群聊分别保存独立 AI 历史。">
          <Switch checked={cfg.ai_context_enabled ?? true} onCheckedChange={(v) => setCfg({ ...cfg, ai_context_enabled: v })} />
        </FieldRow>
        <FieldRow label="每个会话保留轮数" description="建议 1~50，默认 10。">
          <Input
            type="number"
            min="1"
            max="50"
            value={cfg.ai_context_turns ?? 10}
            onChange={(e) => setCfg({ ...cfg, ai_context_turns: Number(e.target.value) })}
            className="h-9"
          />
        </FieldRow>
        <FieldRow label="启用最近群聊上下文" description="群里 @Bot 时参考最近群聊。">
          <Switch
            checked={cfg.ai_group_context_enabled ?? true}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_enabled: v })}
          />
        </FieldRow>
        <FieldRow label="最近群聊消息条数" description="建议 10~30。">
          <Input
            type="number"
            min="1"
            max="50"
            value={cfg.ai_group_context_messages ?? 20}
            disabled={!cfg.ai_group_context_enabled}
            onChange={(e) => setCfg({ ...cfg, ai_group_context_messages: Number(e.target.value) })}
            className="h-9"
          />
        </FieldRow>
        <FieldRow label="优先解析 QQ 引用消息">
          <Switch
            checked={cfg.ai_group_context_include_quote ?? true}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_include_quote: v })}
          />
        </FieldRow>
        <FieldRow label="最近消息中排除 Bot 自己">
          <Switch
            checked={cfg.ai_group_context_exclude_bot ?? true}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_exclude_bot: v })}
          />
        </FieldRow>
        <FieldRow label="AI 回复时引用消息">
          <Switch
            checked={cfg.ai_group_reply_quote_enabled ?? true}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_group_reply_quote_enabled: v })}
          />
        </FieldRow>
        <FieldRow label="优先引用被用户引用的消息">
          <Switch
            checked={cfg.ai_group_reply_quote_prefer_quoted ?? true}
            disabled={!(cfg.ai_group_reply_quote_enabled ?? true)}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_group_reply_quote_prefer_quoted: v })}
          />
        </FieldRow>
        <div className="p-3">
          <Button type="submit" disabled={savingAi}>
            {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
          </Button>
        </div>
      </form>
    )
  } else if (section === 'ai-model') {
    body = (
      <form onSubmit={handleSaveAi} autoComplete="off">
        <div className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <input type="text" name="username" autoComplete="username" tabIndex={-1} />
          <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
        </div>
        <PanelHeader title="模型" description="Provider、模型、推理与 API 凭据" />
        <FieldRow label="AI Provider">
          <Select
            value={aiProvider}
            onValueChange={handleProviderChange}
            options={[
              { value: 'gemini', label: 'Google Gemini' },
              { value: 'openai', label: 'OpenAI Responses' },
            ]}
            className="w-full"
          />
        </FieldRow>
        <FieldRow
          label="启用思考设置"
          description={isOpenAI ? '设置 Responses API 的 reasoning.effort。' : '控制 Gemini 思考预算（thinkingConfig）。'}
        >
          <Switch
            checked={cfg.ai_thinking_enabled ?? true}
            onCheckedChange={(v) => setCfg({ ...cfg, ai_thinking_enabled: v })}
          />
        </FieldRow>
        <FieldRow label="思考程度">
          <Select
            value={cfg.ai_thinking_level ?? 'medium'}
            disabled={!cfg.ai_thinking_enabled}
            onValueChange={(v) => setCfg({ ...cfg, ai_thinking_level: v })}
            options={isOpenAI ? [
              { value: 'none', label: 'none（最低延迟）' },
              { value: 'low', label: 'low' },
              { value: 'medium', label: 'medium（默认）' },
              { value: 'high', label: 'high' },
              { value: 'xhigh', label: 'xhigh' },
              { value: 'max', label: 'max（质量优先）' },
            ] : [
              { value: 'low', label: '低（更快、成本更低）' },
              { value: 'medium', label: '中（默认，均衡）' },
              { value: 'high', label: '高（更强推理）' },
            ]}
            className="w-full"
          />
        </FieldRow>
        {isOpenAI ? (
          <>
            <FieldRow label="启用 Web Search" description="允许 GPT‑5.6 按需搜索互联网，并在回复末尾附上可点击来源。">
              <Switch
                checked={cfg.ai_web_search_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_web_search_enabled: v })}
              />
            </FieldRow>
            <FieldRow label="搜索上下文" description="控制提供给模型的搜索结果信息量，不代表固定来源数量。">
              <Select
                value={cfg.ai_web_search_context_size ?? 'medium'}
                disabled={!cfg.ai_web_search_enabled}
                onValueChange={(value) => setCfg({ ...cfg, ai_web_search_context_size: value })}
                options={[
                  { value: 'low', label: 'low（快速查询）' },
                  { value: 'medium', label: 'medium（默认）' },
                  { value: 'high', label: 'high（更多上下文）' },
                ]}
                className="w-full"
              />
            </FieldRow>
            <FieldRow label="启用 Web Fetch" description="允许 OpenAI Agent 读取已知公开 URL 的正文；本机、内网、超大响应和二进制内容会被拦截。">
              <Switch
                checked={cfg.ai_web_fetch_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_web_fetch_enabled: v })}
              />
            </FieldRow>
          </>
        ) : (
          <>
            <FieldRow label="启用 Google 搜索" description="允许模型联网搜索。">
              <Switch
                checked={cfg.ai_google_search_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_google_search_enabled: v })}
              />
            </FieldRow>
            <FieldRow label="启用网页上下文" description="消息中含公开 URL 时可读取网页内容。">
              <Switch
                checked={cfg.ai_url_context_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_url_context_enabled: v })}
              />
            </FieldRow>
          </>
        )}
        <FieldRow label="API 基础地址">
          <Input
            type="text"
            name="qqbot-ai-base-url"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            spellCheck={false}
            value={cfg.ai_base_url ?? (isOpenAI ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com/v1beta')}
            onChange={(e) => setCfg({ ...cfg, ai_base_url: e.target.value })}
            className="h-9 font-mono text-sm"
          />
        </FieldRow>
        <FieldRow
          label="API 密钥"
          description={
            <span className="flex flex-wrap items-center gap-1">
              {cfg.ai_api_key_clear ? (
                <span className="text-destructive"><AlertCircleIcon className="inline h-3.5 w-3.5" /> 保存后清除</span>
              ) : (cfg.ai_api_key || cfg.ai_api_key_configured) ? (
                <span className="text-teal-700">
                  <CheckCircleIcon className="inline h-3.5 w-3.5" />{' '}
                  {cfg.ai_api_key
                    ? '将更新'
                    : cfg.ai_api_key_source === 'environment'
                      ? `已通过 OPENAI_API_KEY 配置${cfg.ai_api_key_last4 ? `（末四位 ${cfg.ai_api_key_last4}）` : ''}`
                      : `已配置${cfg.ai_api_key_last4 ? `（末四位 ${cfg.ai_api_key_last4}）` : ''}`}
                </span>
              ) : (
                <span className="text-amber-700"><AlertCircleIcon className="inline h-3.5 w-3.5" /> 未配置</span>
              )}
            </span>
          }
        >
          <div className="space-y-2">
            <Input
              type="password"
              name="qqbot-ai-provider-secret"
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              value={cfg.ai_api_key ?? ''}
              onChange={(e) => setCfg({ ...cfg, ai_api_key: e.target.value, ai_api_key_clear: false })}
              placeholder={cfg.ai_api_key_configured ? '留空则保留现有密钥' : (isOpenAI ? '输入 OpenAI API 密钥' : '输入 Gemini API 密钥')}
              className="h-9 font-mono text-sm"
            />
            {cfg.ai_api_key_configured && cfg.ai_api_key_source !== 'environment' && !cfg.ai_api_key_clear && !cfg.ai_api_key ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setCfg({ ...cfg, ai_api_key: '', ai_api_key_clear: true })}
                className="text-destructive hover:bg-destructive/10"
              >
                清除现有密钥
              </Button>
            ) : null}
          </div>
        </FieldRow>
        <FieldRow label="模型名称">
          {isOpenAI ? (
            <Select
              value={cfg.ai_model ?? 'gpt-5.6-sol'}
              onValueChange={(value) => setCfg({ ...cfg, ai_model: value })}
              options={[
                { value: 'gpt-5.6-sol', label: 'gpt-5.6-sol · 旗舰' },
                { value: 'gpt-5.6-terra', label: 'gpt-5.6-terra · 均衡' },
                { value: 'gpt-5.6-luna', label: 'gpt-5.6-luna · 高吞吐' },
                { value: 'gpt-5.6', label: 'gpt-5.6 · Sol 别名' },
              ]}
              className="w-full font-mono"
            />
          ) : (
            <Input
              type="text"
              value={cfg.ai_model ?? 'gemini-3.5-flash'}
              onChange={(e) => setCfg({ ...cfg, ai_model: e.target.value })}
              className="h-9 font-mono text-sm"
            />
          )}
        </FieldRow>
        <div className="p-3">
          <Button type="submit" disabled={savingAi}>
            {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
          </Button>
        </div>
      </form>
    )
  } else {
    body = (
      <form onSubmit={handleSaveAi}>
        <PanelHeader
          title="系统提示词"
          meta={`${systemPromptLines} 行 · ${systemPromptChars} 字`}
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setCfg({ ...cfg, ai_system_prompt: DEFAULT_AI_SYSTEM_PROMPT })}
            >
              恢复默认
            </Button>
          }
        />
        <div className="p-3">
          <Label className="sr-only">系统提示词</Label>
          <Textarea
            value={systemPromptValue}
            onChange={(e) => setCfg({ ...cfg, ai_system_prompt: e.target.value })}
            placeholder={DEFAULT_AI_SYSTEM_PROMPT}
            rows={18}
            className="min-h-[360px] resize-y font-mono text-sm leading-6"
          />
          <p className="mt-2 text-xs text-muted-foreground">定义 AI 的人设和回复风格。</p>
          <Button type="submit" disabled={savingAi} className="mt-3">
            {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <PageHeader
        title="设置"
        subtitle="Bot 行为与 AI 运行时参数"
        action={
          <Button variant="outline" size="sm" onClick={fetchData} disabled={saving || savingAi}>
            <RefreshCwIcon className="h-4 w-4" /> 重新加载
          </Button>
        }
      />
      {ToastEl}

      <DataPanel className="grid min-h-[480px] lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="border-b border-border py-2 lg:border-b-0 lg:border-r">{nav}</nav>
        <div className="relative min-w-0">{body}</div>
      </DataPanel>
    </div>
  )
}
