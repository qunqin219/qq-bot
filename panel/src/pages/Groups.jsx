// 群管理页 —— 群白名单：设置 Bot 仅在指定群回复
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

export default function Groups() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  // 配置状态
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [activeGroups, setActiveGroups] = useState([])

  // 实时群列表
  const [groups, setGroups] = useState([])
  const [connected, setConnected] = useState(false)

  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, groupsData] = await Promise.all([
        api.getConfig(),
        api.getGroups(),
      ])
      setFilterEnabled(!!cfg.group_filter_enabled)
      setActiveGroups(Array.isArray(cfg.active_groups) ? cfg.active_groups : [])
      setGroups(Array.isArray(groupsData.groups) ? groupsData.groups : [])
      setConnected(!!groupsData.connected)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const toggleGroup = (groupId) => {
    if (activeGroups.includes(groupId)) {
      setActiveGroups(activeGroups.filter((g) => g !== groupId))
    } else {
      setActiveGroups([...activeGroups, groupId])
    }
  }

  const selectAll = () => {
    setActiveGroups(groups.map((g) => g.group_id))
  }

  const selectNone = () => {
    setActiveGroups([])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig({
        active_groups: activeGroups,
        group_filter_enabled: filterEnabled,
      })
      success('群白名单设置已保存')
    } catch (e) {
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading text="加载群列表..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="群管理"
        subtitle="设置 Bot 仅在指定群回复（私聊不受限制）"
      />
      {ToastEl}

      <div className="mx-auto max-w-4xl space-y-6">
        {/* 启用开关 */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold text-white">
                启用群白名单
              </div>
              <div className="mt-1 text-sm text-slate-400">
                开启后，Bot 仅在下方勾选的群中回复；关闭则所有群都回复。私聊消息始终不受限制。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFilterEnabled(!filterEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
                filterEnabled ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  filterEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {filterEnabled && activeGroups.length === 0 && (
            <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-300">
              ⚠️ 白名单为空：当前会忽略所有群消息。请在下方勾选至少一个群，或关闭白名单。
            </div>
          )}
        </Card>

        {/* 群列表 */}
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">
              群列表
              <span className="ml-2 text-sm font-normal text-slate-400">
                共 {groups.length} 个 · 已选 {activeGroups.length} 个
              </span>
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                disabled={groups.length === 0}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                全选
              </button>
              <button
                type="button"
                onClick={selectNone}
                disabled={activeGroups.length === 0}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                全不选
              </button>
            </div>
          </div>

          {!connected && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
              ⚠️ Bot 未连接 NapCat，无法获取实时群列表。请等待连接后刷新。
            </div>
          )}

          {connected && groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              暂无群列表
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/70 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">群名</th>
                    <th className="px-4 py-3 font-medium">群号</th>
                    <th className="px-4 py-3 text-center font-medium">成员数</th>
                    <th className="px-4 py-3 text-center font-medium">启用</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {groups.map((g) => {
                    const gid = g.group_id
                    const checked = activeGroups.includes(gid)
                    return (
                      <tr
                        key={gid}
                        className={`transition ${
                          checked ? 'bg-sky-950/30' : 'hover:bg-slate-900/40'
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
                              {(g.group_name || String(gid)).slice(0, 1)}
                            </span>
                            <span className="truncate">
                              {g.group_name || '(未命名)'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {gid}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-400">
                          {g.member_count ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGroup(gid)}
                            className="h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 保存按钮 */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={fetchData}
            disabled={saving}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中...' : '💾 保存白名单'}
          </button>
        </div>
      </div>
    </div>
  )
}
