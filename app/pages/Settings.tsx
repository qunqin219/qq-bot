// 设置页 —— 基础设置、AI 回复配置
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeSystemPrompt,
} from '../../lib/shared/system-prompt'
import { Card, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertCircleIcon, BrainIcon, CheckCircleIcon, RefreshCwIcon, SaveIcon } from '../../components/Icons'
import type { ConfigResponse } from '../../lib/shared/types'

type Cfg = ConfigResponse & Record<string, unknown>

export default function Settings() {
  const [cfg, setCfg] = useState<Cfg>(null as unknown as Cfg)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
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

  // 保存基础设置
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

  // 保存 AI 配置
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
    <div>
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

      <div className="mx-auto max-w-2xl space-y-5">
        {/* ── 基础设置卡片 ── */}
        <Card className="gap-0 p-0">
          <PanelHeader
            title="基础设置"
            description="连接地址和命令前缀。"
          />
            <form onSubmit={handleSave} className="space-y-5 px-5 py-4">
              {/* 命令前缀 */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">命令前缀</Label>
                <Input
                  type="text"
                  value={cfg.command_prefix ?? '/'}
                  onChange={(e) =>
                    setCfg({ ...cfg, command_prefix: e.target.value })
                  }
                  placeholder="/"
                  className="mt-2 h-9"
                />
                <p className="mt-1 text-xs text-slate-400">
                  以此前缀开头的消息会被当作命令处理（如 /ping）。
                </p>
              </div>

              {/* NapCat WS 地址 */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">NapCat WebSocket 地址</Label>
                <Input
                  type="text"
                  value={cfg.napcat_ws ?? 'ws://127.0.0.1:3001'}
                  onChange={(e) =>
                    setCfg({ ...cfg, napcat_ws: e.target.value })
                  }
                  placeholder="ws://127.0.0.1:3001"
                  className="mt-2 h-9 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  修改后需重启 Bot 生效。
                </p>
              </div>

              {/* 保存按钮 */}
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? '保存中...' : <><SaveIcon className="h-4 w-4" /> 保存基础设置</>}
              </Button>
            </form>
        </Card>

        {/* ── AI 回复配置卡片 ── */}
        <Card className="gap-0 p-0">
          <PanelHeader
            title="AI 回复配置"
            description="控制触发、上下文、工具和 Gemini API 参数。"
            meta={cfg.ai_enabled ? '已启用' : '未启用'}
          />
            <form onSubmit={handleSaveAi} className="space-y-5 px-5 py-4" autoComplete="off">
              <div className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <input type="text" name="username" autoComplete="username" tabIndex={-1} />
                <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
              </div>
              {/* 启用 AI 回复开关 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    启用 AI 回复
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    开启后使用 Gemini API 生成回复
                  </div>
                </div>
                <Switch
                  checked={cfg.ai_enabled ?? false}
                  onCheckedChange={(v) => setCfg({ ...cfg, ai_enabled: v })}
                />
              </div>

              {/* 个性化记忆 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    启用个性化记忆
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    开启后，模型可按当前私聊/群聊会话独立创建、更新和删除记忆。
                  </div>
                </div>
                <Switch
                  checked={cfg.ai_memory_enabled ?? true}
                  onCheckedChange={(v) => setCfg({ ...cfg, ai_memory_enabled: v })}
                />
              </div>

              {/* 允许群成员 @ 触发 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    允许群成员 @Bot 触发 AI
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    开启后，非管理员在允许的群里 @Bot 也可以触发 AI。私聊和命令仍只允许管理员。
                  </div>
                </div>
                <Switch
                  checked={cfg.ai_allow_group_mention_from_non_admin ?? false}
                  onCheckedChange={(v) =>
                    setCfg({ ...cfg, ai_allow_group_mention_from_non_admin: v })
                  }
                />
              </div>

              {/* 过滤表情包 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    过滤 QQ 表情包/动画表情
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    开启后，群聊上下文会跳过动画表情；单独 @Bot 只发表情包时不会触发 AI。普通图片仍可识别。
                  </div>
                </div>
                <Switch
                  checked={cfg.ai_filter_stickers ?? true}
                  onCheckedChange={(v) => setCfg({ ...cfg, ai_filter_stickers: v })}
                />
              </div>

              {/* 群聊 AI 回复引用 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <div className="text-sm font-medium text-slate-900">
                    群聊 AI 回复引用消息
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    只发送 QQ 引用，不额外 @ 人，避免产生很吵的 @ 提醒。
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">AI 回复时引用消息</div>
                      <div className="mt-0.5 text-xs text-slate-400">群里 @Bot 后，Bot 回复会带 [CQ:reply]，但不会带 [CQ:at]。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_group_reply_quote_enabled ?? true}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_group_reply_quote_enabled: v as boolean })
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">优先引用被用户引用的消息</div>
                      <div className="mt-0.5 text-xs text-slate-400">如果用户是"引用某条消息 + @Bot"，Bot 会引用那条原消息；模型也可以根据上下文主动选择要引用的消息。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_group_reply_quote_prefer_quoted ?? true}
                      disabled={!(cfg.ai_group_reply_quote_enabled ?? true)}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_group_reply_quote_prefer_quoted: v as boolean })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* 群聊上下文增强 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <div className="text-sm font-medium text-slate-900">
                    群聊上下文增强
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    群里 @Bot 时，同时参考 QQ 引用消息和最近群聊，避免 AI 不知道"上面那个"指什么。
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">启用最近群聊上下文</div>
                      <div className="mt-0.5 text-xs text-slate-400">只在群聊 @Bot 时生效；私聊不受影响。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_group_context_enabled ?? true}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_group_context_enabled: v as boolean })
                      }
                    />
                  </label>

                  <div>
                    <Label>最近群聊消息条数</Label>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={cfg.ai_group_context_messages ?? 20}
                      disabled={!cfg.ai_group_context_enabled}
                      onChange={(e) =>
                        setCfg({ ...cfg, ai_group_context_messages: Number(e.target.value) })
                      }
                      placeholder="20"
                      className="mt-2"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      建议 10~30。系统会排除当前 @Bot 消息，并按时间顺序提供最近聊天片段。
                    </p>
                  </div>

                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">优先解析 QQ 引用消息</div>
                      <div className="mt-0.5 text-xs text-slate-400">检测 [CQ:reply] 并通过 get_msg 拉取被引用消息，作为重点上下文。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_group_context_include_quote ?? true}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_group_context_include_quote: v as boolean })
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">最近消息中排除 Bot 自己</div>
                      <div className="mt-0.5 text-xs text-slate-400">避免 AI 把自己之前的回复当成群友上文反复解释。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_group_context_exclude_bot ?? true}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_group_context_exclude_bot: v as boolean })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* 启用上下文记忆开关 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    启用上下文记忆
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    每个私聊和群聊分别保存独立 AI 历史
                  </div>
                </div>
                <Switch
                  checked={cfg.ai_context_enabled ?? true}
                  onCheckedChange={(v) => setCfg({ ...cfg, ai_context_enabled: v })}
                />
              </div>

              {/* 上下文轮数 */}
              <div>
                <Label>每个会话保留轮数</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  value={cfg.ai_context_turns ?? 10}
                  onChange={(e) =>
                    setCfg({ ...cfg, ai_context_turns: Number(e.target.value) })
                  }
                  placeholder="10"
                  className="mt-2"
                />
                <p className="mt-1 text-xs text-slate-400">
                  建议 1~50，默认 10；每轮包含一条用户消息和一条 AI 回复。
                </p>
              </div>

              {/* Gemini 3.5 思考配置 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      启用 Gemini 3.5 思考设置
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      generateContent 兼容字段：generationConfig.thinkingConfig.thinkingBudget
                    </div>
                  </div>
                  <Switch
                    checked={cfg.ai_thinking_enabled ?? true}
                    onCheckedChange={(v) => setCfg({ ...cfg, ai_thinking_enabled: v })}
                  />
                </div>

                <div className="mt-4">
                  <Label>思考程度</Label>
                  <Select
                    value={cfg.ai_thinking_level ?? 'medium'}
                    disabled={!cfg.ai_thinking_enabled}
                    onValueChange={(v) => setCfg({ ...cfg, ai_thinking_level: v })}
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low：低思考，适合简单问答，成本更低</SelectItem>
                      <SelectItem value="medium">medium：默认，平衡质量和速度</SelectItem>
                      <SelectItem value="high">high：高思考，适合复杂推理</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-slate-400">
                    low / medium / high 会映射为不同 thinkingBudget。关闭此开关时不传 thinkingConfig，让模型或中转使用默认策略。
                  </p>
                </div>
              </div>

              {/* Gemini 内置工具 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <div className="text-sm font-medium text-slate-900">
                    Gemini 内置工具
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    使用 generateContent 的 tools 字段。搜索和网页上下文是否可用取决于你的 Gemini 中转支持程度。
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">启用 Google Search 联网搜索</div>
                      <div className="mt-0.5 text-xs text-slate-400">字段：tools: [&#123; googleSearch: &#123;&#125; &#125;]</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_google_search_enabled ?? false}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_google_search_enabled: v as boolean })
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">启用 URL Context 网页上下文</div>
                      <div className="mt-0.5 text-xs text-slate-400">字段：tools: [{` urlContext: {} `}]，消息中包含公开 URL 时可读取网页内容。</div>
                    </div>
                    <Checkbox
                      checked={cfg.ai_url_context_enabled ?? false}
                      onCheckedChange={(v) =>
                        setCfg({ ...cfg, ai_url_context_enabled: v as boolean })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* API Base URL */}
              <div>
                <Label>API Base URL</Label>
                <Input
                  type="text"
                  name="qqbot-ai-base-url"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  spellCheck={false}
                  value={
                    cfg.ai_base_url ??
                    'https://generativelanguage.googleapis.com/v1beta'
                  }
                  onChange={(e) =>
                    setCfg({ ...cfg, ai_base_url: e.target.value })
                  }
                  placeholder="https://generativelanguage.googleapis.com/v1beta"
                  className="mt-2 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Gemini API 基础地址，一般无需修改。
                </p>
              </div>

              {/* API Key */}
              <div>
                <Label>API Key</Label>
                <Input
                  type="password"
                  name="qqbot-ai-provider-secret"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  spellCheck={false}
                  value={cfg.ai_api_key ?? ''}
                  onChange={(e) =>
                    setCfg({ ...cfg, ai_api_key: e.target.value, ai_api_key_clear: false })
                  }
                  placeholder={cfg.ai_api_key_configured ? '留空则保留现有 API Key' : '输入 Gemini API Key'}
                  className="mt-2 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  {cfg.ai_api_key_clear ? (
                    <span className="flex items-center gap-1 text-red-700"><AlertCircleIcon className="h-3.5 w-3.5" /> 保存后清除</span>
                  ) : (cfg.ai_api_key || cfg.ai_api_key_configured) ? (
                    <span className="flex items-center gap-1 text-emerald-700">
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      {cfg.ai_api_key ? '将更新' : `已配置${cfg.ai_api_key_last4 ? `（末四位 ${cfg.ai_api_key_last4}）` : ''}`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-700"><AlertCircleIcon className="h-3.5 w-3.5" /> 未配置</span>
                  )}
                  ，可在{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-900 underline hover:text-slate-700"
                  >
                    Google AI Studio
                  </a>{' '}
                  获取。
                </p>
                {cfg.ai_api_key_configured && !cfg.ai_api_key_clear && !cfg.ai_api_key ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCfg({ ...cfg, ai_api_key: '', ai_api_key_clear: true })}
                    className="mt-2 text-red-700 hover:bg-red-50"
                  >
                    清除现有 API Key
                  </Button>
                ) : null}
              </div>

              {/* 模型 */}
              <div>
                <Label>模型名称</Label>
                <Input
                  type="text"
                  value={cfg.ai_model ?? 'gemini-3.5-flash'}
                  onChange={(e) => setCfg({ ...cfg, ai_model: e.target.value })}
                  placeholder="gemini-3.5-flash"
                  className="mt-2 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Gemini 3.5 Flash 推荐使用 gemini-3.5-flash。
                </p>
              </div>

              {/* System Prompt */}
              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <Label className="text-base font-semibold text-slate-950">
                      System Prompt（系统提示词）
                    </Label>
                    <div className="mt-1 text-xs font-medium text-slate-400">
                      {systemPromptLines} 行 · {systemPromptChars} 字
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCfg({ ...cfg, ai_system_prompt: DEFAULT_AI_SYSTEM_PROMPT })
                    }
                  >
                    恢复默认提示词
                  </Button>
                </div>
                <Textarea
                  value={systemPromptValue}
                  onChange={(e) =>
                    setCfg({ ...cfg, ai_system_prompt: e.target.value })
                  }
                  placeholder={DEFAULT_AI_SYSTEM_PROMPT}
                  rows={24}
                  className="min-h-[520px] resize-y bg-white px-4 py-3 text-sm leading-7 text-slate-800 shadow-inner shadow-slate-950/5"
                />
                <p className="mt-1 text-xs text-slate-400">
                  定义 AI 的人设和回复风格。
                </p>
              </div>

              {/* 保存按钮 */}
              <Button type="submit" disabled={savingAi} className="w-full">
                {savingAi ? '保存中...' : <><BrainIcon className="h-4 w-4" /> 保存 AI 配置</>}
              </Button>
            </form>
        </Card>
      </div>
    </div>
  )
}
