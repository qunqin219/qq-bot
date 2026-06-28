// 设置页 —— 基础设置、AI 回复配置
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

export default function Settings() {
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getConfig()
      setCfg(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // 保存基础设置
  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateConfig({
        command_prefix: cfg.command_prefix,
        napcat_ws: cfg.napcat_ws,
      })
      success('基础设置已保存')
    } catch (e) {
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // 保存 AI 配置
  const handleSaveAi = async (e) => {
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
      await api.updateConfig({
        ai_enabled: cfg.ai_enabled ?? false,
        ai_base_url: baseUrl,
        ai_api_key: cfg.ai_api_key,
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
      })
      success('AI 配置已保存')
    } catch (e) {
      toastError(e.message)
    } finally {
      setSavingAi(false)
    }
  }

  if (loading) return <Loading text="加载设置..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader title="设置" subtitle="配置 Bot 行为参数" />
      {ToastEl}

      <div className="mx-auto max-w-2xl space-y-6">
        {/* ── 基础设置卡片 ── */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h3 className="text-lg font-semibold text-white">基础设置</h3>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            {/* 命令前缀 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                命令前缀
              </label>
              <input
                type="text"
                value={cfg.command_prefix ?? '/'}
                onChange={(e) =>
                  setCfg({ ...cfg, command_prefix: e.target.value })
                }
                placeholder="/"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                以此前缀开头的消息会被当作命令处理（如 /ping）。
              </p>
            </div>

            {/* NapCat WS 地址 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                NapCat WebSocket 地址
              </label>
              <input
                type="text"
                value={cfg.napcat_ws ?? 'ws://127.0.0.1:3001'}
                onChange={(e) =>
                  setCfg({ ...cfg, napcat_ws: e.target.value })
                }
                placeholder="ws://127.0.0.1:3001"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                修改后需重启 Bot 生效。
              </p>
            </div>

            {/* 保存按钮 */}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '💾 保存基础设置'}
            </button>
          </form>
        </Card>

        {/* ── AI 回复配置卡片 ── */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <h3 className="text-lg font-semibold text-white">AI 回复配置</h3>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            AI 未启用或未填写 API Key 时，Bot 不会自动回复。
          </p>
          <p className="mb-4 text-xs text-slate-500">
            群聊中只有 @Bot 才会触发 AI 回复；私聊会直接触发。
          </p>
          <p className="mb-4 text-xs text-slate-500">
            私聊和每个群聊的上下文会独立保存，互不串线。
          </p>

          <form onSubmit={handleSaveAi} className="space-y-6" autoComplete="off">
            <div className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <input type="text" name="username" autoComplete="username" tabIndex={-1} />
              <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
            </div>
            {/* 启用 AI 回复开关 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  启用 AI 回复
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  开启后使用 Gemini API 生成回复
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCfg({ ...cfg, ai_enabled: !cfg.ai_enabled })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  cfg.ai_enabled ? 'bg-emerald-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    cfg.ai_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 个性化记忆 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  启用个性化记忆
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  开启后，模型可按当前私聊/群聊会话独立创建、更新和删除记忆。
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCfg({ ...cfg, ai_memory_enabled: !cfg.ai_memory_enabled })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  (cfg.ai_memory_enabled ?? true) ? 'bg-emerald-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    (cfg.ai_memory_enabled ?? true) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 允许群成员 @ 触发 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  允许群成员 @Bot 触发 AI
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  开启后，非管理员在允许的群里 @Bot 也可以触发 AI。私聊和命令仍只允许管理员。
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCfg({
                    ...cfg,
                    ai_allow_group_mention_from_non_admin:
                      !cfg.ai_allow_group_mention_from_non_admin,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  cfg.ai_allow_group_mention_from_non_admin ? 'bg-emerald-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    cfg.ai_allow_group_mention_from_non_admin ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 过滤表情包 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  过滤 QQ 表情包/动画表情
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  开启后，群聊上下文会跳过动画表情；单独 @Bot 只发表情包时不会触发 AI。普通图片仍可识别。
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCfg({ ...cfg, ai_filter_stickers: !cfg.ai_filter_stickers })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  (cfg.ai_filter_stickers ?? true) ? 'bg-emerald-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    (cfg.ai_filter_stickers ?? true) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 群聊 AI 回复引用 */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="mb-3">
                <div className="text-sm font-medium text-slate-200">
                  群聊 AI 回复引用消息
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  只发送 QQ 引用，不额外 @ 人，避免产生很吵的 @ 提醒。
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">AI 回复时引用消息</div>
                    <div className="mt-0.5 text-xs text-slate-500">群里 @Bot 后，Bot 回复会带 [CQ:reply]，但不会带 [CQ:at]。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_group_reply_quote_enabled ?? true}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_reply_quote_enabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>

                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">优先引用被用户引用的消息</div>
                    <div className="mt-0.5 text-xs text-slate-500">如果用户是“引用某条消息 + @Bot”，Bot 会引用那条原消息；模型也可以根据上下文主动选择要引用的消息。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_group_reply_quote_prefer_quoted ?? true}
                    disabled={!(cfg.ai_group_reply_quote_enabled ?? true)}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_reply_quote_prefer_quoted: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </div>
            </div>

            {/* 群聊上下文增强 */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="mb-3">
                <div className="text-sm font-medium text-slate-200">
                  群聊上下文增强
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  群里 @Bot 时，同时参考 QQ 引用消息和最近群聊，避免 AI 不知道“上面那个”指什么。
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">启用最近群聊上下文</div>
                    <div className="mt-0.5 text-xs text-slate-500">只在群聊 @Bot 时生效；私聊不受影响。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_group_context_enabled ?? true}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_context_enabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    最近群聊消息条数
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={cfg.ai_group_context_messages ?? 20}
                    disabled={!cfg.ai_group_context_enabled}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_context_messages: Number(e.target.value) })
                    }
                    placeholder="20"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    建议 10~30。系统会排除当前 @Bot 消息，并按时间顺序提供最近聊天片段。
                  </p>
                </div>

                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">优先解析 QQ 引用消息</div>
                    <div className="mt-0.5 text-xs text-slate-500">检测 [CQ:reply] 并通过 get_msg 拉取被引用消息，作为重点上下文。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_group_context_include_quote ?? true}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_context_include_quote: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>

                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">最近消息中排除 Bot 自己</div>
                    <div className="mt-0.5 text-xs text-slate-500">避免 AI 把自己之前的回复当成群友上文反复解释。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_group_context_exclude_bot ?? true}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_group_context_exclude_bot: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>
              </div>
            </div>

            {/* 启用上下文记忆开关 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-200">
                  启用上下文记忆
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  每个私聊和群聊分别保存独立 AI 历史
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setCfg({ ...cfg, ai_context_enabled: !cfg.ai_context_enabled })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  cfg.ai_context_enabled ? 'bg-emerald-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    cfg.ai_context_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* 上下文轮数 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                每个会话保留轮数
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={cfg.ai_context_turns ?? 10}
                onChange={(e) =>
                  setCfg({ ...cfg, ai_context_turns: Number(e.target.value) })
                }
                placeholder="10"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                建议 1~50，默认 10；每轮包含一条用户消息和一条 AI 回复。
              </p>
            </div>

            {/* Gemini 3.5 思考配置 */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    启用 Gemini 3.5 思考设置
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    generateContent 兼容字段：generationConfig.thinkingConfig.thinkingBudget
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCfg({ ...cfg, ai_thinking_enabled: !cfg.ai_thinking_enabled })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    cfg.ai_thinking_enabled ? 'bg-emerald-600' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      cfg.ai_thinking_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  思考程度
                </label>
                <select
                  value={cfg.ai_thinking_level ?? 'medium'}
                  disabled={!cfg.ai_thinking_enabled}
                  onChange={(e) =>
                    setCfg({ ...cfg, ai_thinking_level: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="low">low：低思考，适合简单问答，成本更低</option>
                  <option value="medium">medium：默认，平衡质量和速度</option>
                  <option value="high">high：高思考，适合复杂推理</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  low / medium / high 会映射为不同 thinkingBudget。关闭此开关时不传 thinkingConfig，让模型或中转使用默认策略。
                </p>
              </div>
            </div>

            {/* Gemini 内置工具 */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="mb-3">
                <div className="text-sm font-medium text-slate-200">
                  Gemini 内置工具
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  使用 generateContent 的 tools 字段。搜索和网页上下文是否可用取决于你的 Gemini 中转支持程度。
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">启用 Google Search 联网搜索</div>
                    <div className="mt-0.5 text-xs text-slate-500">字段：tools: [&#123; googleSearch: &#123;&#125; &#125;]</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_google_search_enabled ?? false}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_google_search_enabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>

                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-200">启用 URL Context 网页上下文</div>
                    <div className="mt-0.5 text-xs text-slate-500">字段：tools: [&#123; urlContext: &#123;&#125; &#125;]，消息中包含公开 URL 时可读取网页内容。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={cfg.ai_url_context_enabled ?? false}
                    onChange={(e) =>
                      setCfg({ ...cfg, ai_url_context_enabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                  />
                </label>
              </div>
            </div>

            {/* API Base URL */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                API Base URL
              </label>
              <input
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
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Gemini API 基础地址，一般无需修改。
              </p>
            </div>

            {/* API Key */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                API Key
              </label>
              <input
                type="password"
                name="qqbot-ai-provider-secret"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                spellCheck={false}
                value={cfg.ai_api_key ?? ''}
                onChange={(e) =>
                  setCfg({ ...cfg, ai_api_key: e.target.value })
                }
                placeholder="输入 Gemini API Key"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                {cfg.ai_api_key ? (
                  <span className="text-emerald-400">✓ 已配置</span>
                ) : (
                  <span className="text-amber-400">⚠ 未配置</span>
                )}
                ，可在{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 underline hover:text-sky-300"
                >
                  Google AI Studio
                </a>{' '}
                获取。
              </p>
            </div>

            {/* 模型 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                模型名称
              </label>
              <input
                type="text"
                value={cfg.ai_model ?? 'gemini-3.5-flash'}
                onChange={(e) => setCfg({ ...cfg, ai_model: e.target.value })}
                placeholder="gemini-3.5-flash"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Gemini 3.5 Flash 推荐使用 gemini-3.5-flash。
              </p>
            </div>

            {/* System Prompt */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                System Prompt（系统提示词）
              </label>
              <textarea
                value={
                  cfg.ai_system_prompt ?? '你是一个友好的QQ群助手，回答简洁有趣。'
                }
                onChange={(e) =>
                  setCfg({ ...cfg, ai_system_prompt: e.target.value })
                }
                placeholder="你是一个友好的QQ群助手，回答简洁有趣。"
                rows={3}
                className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                定义 AI 的人设和回复风格。
              </p>
            </div>

            {/* 保存按钮 */}
            <button
              type="submit"
              disabled={savingAi}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAi ? '保存中...' : '🤖 保存 AI 配置'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
