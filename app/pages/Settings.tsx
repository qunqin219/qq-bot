// 设置页 —— 基础设置、AI 回复配置
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../../lib/api/client'
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeSystemPrompt,
} from '../../lib/shared/system-prompt'
import { Card, Loading, ErrorBox, PageHeader, SectionTitle, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertCircleIcon, BrainIcon, CheckCircleIcon, RefreshCwIcon, SaveIcon } from '../../components/Icons'
import type { ConfigResponse } from '../../lib/shared/types'

type Cfg = ConfigResponse & Record<string, unknown>

interface SettingRowProps {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}

function SettingRow({ label, description, children, className = '' }: SettingRowProps) {
  return (
    <div className={`flex flex-col gap-3 border-b border-border p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 sm:w-[260px]">{children}</div>
    </div>
  )
}

export default function Settings() {
  const [cfg, setCfg] = useState<Cfg>(null as unknown as Cfg)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [tab, setTab] = useState('basic')
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

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
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

  const handleSaveAi = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
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
        ai_base_url: baseUrl,
        ai_model: cfg.ai_model,
        ai_system_prompt: cfg.ai_system_prompt,
        ai_context_enabled: cfg.ai_context_enabled ?? true,
        ai_context_turns: Number(cfg.ai_context_turns || 10),
        ai_thinking_enabled: cfg.ai_thinking_enabled ?? true,
        ai_thinking_level: cfg.ai_thinking_level || 'medium',
        ai_google_search_enabled: cfg.ai_google_search_enabled ?? false,
        ai_url_context_enabled: cfg.ai_url_context_enabled ?? false,
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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="设置"
        subtitle="配置 Bot 行为参数"
        action={
          <Button variant="outline" onClick={fetchData} disabled={saving || savingAi}>
            <RefreshCwIcon className="h-4 w-4" /> 重新加载
          </Button>
        }
      />
      {ToastEl}

      <Tabs value={tab} onValueChange={setTab} className="mb-5">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="basic">基础</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'basic' && (
        <Card className="p-0">
          <form onSubmit={handleSave}>
            <SettingRow
              label="命令前缀"
              description="以此前缀开头的消息会被当作命令处理（如 /ping）。"
            >
              <Input
                type="text"
                value={cfg.command_prefix ?? '/'}
                onChange={(e) => setCfg({ ...cfg, command_prefix: e.target.value })}
                placeholder="/"
                className="h-9"
              />
            </SettingRow>

            <SettingRow
              label="NapCat WebSocket 地址"
              description="修改后需重启 Bot 生效。"
            >
              <Input
                type="text"
                value={cfg.napcat_ws ?? 'ws://127.0.0.1:3001'}
                onChange={(e) => setCfg({ ...cfg, napcat_ws: e.target.value })}
                placeholder="ws://127.0.0.1:3001"
                className="h-9 font-mono text-sm"
              />
            </SettingRow>

            <div className="p-4">
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? '保存中...' : <><SaveIcon className="h-4 w-4" /> 保存基础设置</>}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'ai' && (
        <form onSubmit={handleSaveAi} autoComplete="off" className="space-y-5">
          <div className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <input type="text" name="username" autoComplete="username" tabIndex={-1} />
            <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
          </div>

          <Card className="p-0">
            <div className="border-b border-border px-4 py-3">
              <SectionTitle>开关与记忆</SectionTitle>
            </div>
            <SettingRow
              label="启用 AI 回复"
              description="开启后使用 Gemini API 生成回复。"
            >
              <Switch
                checked={cfg.ai_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="启用个性化记忆"
              description="模型可按当前私聊/群聊会话独立创建、更新和删除记忆。"
            >
              <Switch
                checked={cfg.ai_memory_enabled ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_memory_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="允许群成员 @Bot 触发 AI"
              description="非管理员在允许的群里 @Bot 也可以触发 AI。私聊和命令仍只允许管理员。"
            >
              <Switch
                checked={cfg.ai_allow_group_mention_from_non_admin ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_allow_group_mention_from_non_admin: v })}
              />
            </SettingRow>

            <SettingRow
              label="过滤 QQ 表情包/动画表情"
              description="群聊上下文会跳过动画表情；单独 @Bot 只发表情包时不会触发 AI。普通图片仍可识别。"
            >
              <Switch
                checked={cfg.ai_filter_stickers ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_filter_stickers: v })}
              />
            </SettingRow>
          </Card>

          <Card className="p-0">
            <div className="border-b border-border px-4 py-3">
              <SectionTitle>上下文与引用</SectionTitle>
            </div>
            <SettingRow
              label="启用上下文记忆"
              description="每个私聊和群聊分别保存独立 AI 历史。"
            >
              <Switch
                checked={cfg.ai_context_enabled ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_context_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="每个会话保留轮数"
              description="建议 1~50，默认 10；每轮包含一条用户消息和一条 AI 回复。"
            >
              <Input
                type="number"
                min="1"
                max="50"
                value={cfg.ai_context_turns ?? 10}
                onChange={(e) => setCfg({ ...cfg, ai_context_turns: Number(e.target.value) })}
                placeholder="10"
                className="h-9"
              />
            </SettingRow>

            <SettingRow
              label="启用最近群聊上下文"
              description="群里 @Bot 时同时参考最近群聊，只在群聊 @Bot 时生效。"
            >
              <Switch
                checked={cfg.ai_group_context_enabled ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="最近群聊消息条数"
              description="建议 10~30。系统会排除当前 @Bot 消息，并按时间顺序提供最近聊天片段。"
            >
              <Input
                type="number"
                min="1"
                max="50"
                value={cfg.ai_group_context_messages ?? 20}
                disabled={!cfg.ai_group_context_enabled}
                onChange={(e) => setCfg({ ...cfg, ai_group_context_messages: Number(e.target.value) })}
                placeholder="20"
                className="h-9"
              />
            </SettingRow>

            <SettingRow
              label="优先解析 QQ 引用消息"
              description="检测 [CQ:reply] 并通过 get_msg 拉取被引用消息，作为重点上下文。"
            >
              <Checkbox
                checked={cfg.ai_group_context_include_quote ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_include_quote: v })}
              />
            </SettingRow>

            <SettingRow
              label="最近消息中排除 Bot 自己"
              description="避免 AI 把自己之前的回复当成群友上文反复解释。"
            >
              <Checkbox
                checked={cfg.ai_group_context_exclude_bot ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_group_context_exclude_bot: v })}
              />
            </SettingRow>

            <SettingRow
              label="AI 回复时引用消息"
              description="群里 @Bot 后，Bot 回复会带 [CQ:reply]，但不会带 [CQ:at]。"
            >
              <Checkbox
                checked={cfg.ai_group_reply_quote_enabled ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_group_reply_quote_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="优先引用被用户引用的消息"
              description="如果用户是“引用某条消息 + @Bot”，Bot 会引用那条原消息。"
            >
              <Checkbox
                checked={cfg.ai_group_reply_quote_prefer_quoted ?? true}
                disabled={!(cfg.ai_group_reply_quote_enabled ?? true)}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_group_reply_quote_prefer_quoted: v })}
              />
            </SettingRow>
          </Card>

          <Card className="p-0">
            <div className="border-b border-border px-4 py-3">
              <SectionTitle>工具与模型</SectionTitle>
            </div>
            <SettingRow
              label="启用 Gemini 3.5 思考设置"
              description="generateContent 兼容字段：generationConfig.thinkingConfig.thinkingBudget。"
            >
              <Switch
                checked={cfg.ai_thinking_enabled ?? true}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_thinking_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="思考程度"
              description="low / medium / high 会映射为不同 thinkingBudget。"
            >
              <Select
                value={cfg.ai_thinking_level ?? 'medium'}
                disabled={!cfg.ai_thinking_enabled}
                onValueChange={(v) => setCfg({ ...cfg, ai_thinking_level: v })}
                options={[
                  { value: 'low', label: 'low：低思考，成本更低' },
                  { value: 'medium', label: 'medium：默认，平衡质量和速度' },
                  { value: 'high', label: 'high：高思考，适合复杂推理' },
                ]}
                className="w-full"
              />
            </SettingRow>

            <SettingRow
              label="启用 Google Search 联网搜索"
              description="字段：tools: [{ googleSearch: {} }]。"
            >
              <Checkbox
                checked={cfg.ai_google_search_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_google_search_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="启用 URL Context 网页上下文"
              description="消息中包含公开 URL 时可读取网页内容。"
            >
              <Checkbox
                checked={cfg.ai_url_context_enabled ?? false}
                onCheckedChange={(v) => setCfg({ ...cfg, ai_url_context_enabled: v })}
              />
            </SettingRow>

            <SettingRow
              label="API Base URL"
              description="Gemini API 基础地址，一般无需修改。"
            >
              <Input
                type="text"
                name="qqbot-ai-base-url"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                value={cfg.ai_base_url ?? 'https://generativelanguage.googleapis.com/v1beta'}
                onChange={(e) => setCfg({ ...cfg, ai_base_url: e.target.value })}
                placeholder="https://generativelanguage.googleapis.com/v1beta"
                className="h-9 font-mono text-sm"
              />
            </SettingRow>

            <SettingRow
              label="API Key"
              description={
                <span className="flex items-center gap-1">
                  {cfg.ai_api_key_clear ? (
                    <span className="text-destructive"><AlertCircleIcon className="inline h-3.5 w-3.5" /> 保存后清除</span>
                  ) : (cfg.ai_api_key || cfg.ai_api_key_configured) ? (
                    <span className="text-emerald-700">
                      <CheckCircleIcon className="inline h-3.5 w-3.5" /> {cfg.ai_api_key ? '将更新' : `已配置${cfg.ai_api_key_last4 ? `（末四位 ${cfg.ai_api_key_last4}）` : ''}`}
                    </span>
                  ) : (
                    <span className="text-amber-700"><AlertCircleIcon className="inline h-3.5 w-3.5" /> 未配置</span>
                  )}
                  ，可在{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline hover:text-muted-foreground"
                  >
                    Google AI Studio
                  </a>{' '}
                  获取。
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
                  placeholder={cfg.ai_api_key_configured ? '留空则保留现有 API Key' : '输入 Gemini API Key'}
                  className="h-9 font-mono text-sm"
                />
                {cfg.ai_api_key_configured && !cfg.ai_api_key_clear && !cfg.ai_api_key ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setCfg({ ...cfg, ai_api_key: '', ai_api_key_clear: true })}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    清除现有 API Key
                  </Button>
                ) : null}
              </div>
            </SettingRow>

            <SettingRow
              label="模型名称"
              description="Gemini 3.5 Flash 推荐使用 gemini-3.5-flash。"
            >
              <Input
                type="text"
                value={cfg.ai_model ?? 'gemini-3.5-flash'}
                onChange={(e) => setCfg({ ...cfg, ai_model: e.target.value })}
                placeholder="gemini-3.5-flash"
                className="h-9 font-mono text-sm"
              />
            </SettingRow>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label className="text-base font-semibold text-foreground">
                  System Prompt（系统提示词）
                </Label>
                <div className="mt-1 text-xs font-medium text-muted-foreground">
                  {systemPromptLines} 行 · {systemPromptChars} 字
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCfg({ ...cfg, ai_system_prompt: DEFAULT_AI_SYSTEM_PROMPT })}
              >
                恢复默认提示词
              </Button>
            </div>
            <Textarea
              value={systemPromptValue}
              onChange={(e) => setCfg({ ...cfg, ai_system_prompt: e.target.value })}
              placeholder={DEFAULT_AI_SYSTEM_PROMPT}
              rows={20}
              className="min-h-[400px] resize-y px-4 py-3 text-sm leading-7"
            />
            <p className="mt-2 text-xs text-muted-foreground">定义 AI 的人设和回复风格。</p>
          </Card>

          <Button type="submit" disabled={savingAi} className="w-full">
            {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
          </Button>
        </form>
      )}
    </div>
  )
}
