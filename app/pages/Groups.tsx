// 群管理页 —— 群白名单：设置 Bot 仅在指定群回复
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RefreshCwIcon, SaveIcon, UsersIcon } from '../../components/Icons'
import type { GroupInfo } from '../../lib/shared/types'
export default function Groups() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 配置状态
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [activeGroups, setActiveGroups] = useState<Array<number | string>>([])

  // 实时群列表
  const [groups, setGroups] = useState<GroupInfo[]>([])
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
      setConnected(!!(groupsData as { connected?: boolean }).connected)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const toggleGroup = (groupId: number | string) => {
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
      toastError(e instanceof Error ? e.message : String(e))
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
        action={
          <>
            <Button variant="outline" onClick={fetchData} disabled={saving}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : <><SaveIcon className="h-4 w-4" /> 保存白名单</>}
            </Button>
          </>
        }
      />
      {ToastEl}

      <div className="space-y-5">
        {/* 启用开关 */}
        <Card className="gap-0 p-0">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-slate-950">
                  群白名单
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${filterEnabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {filterEnabled ? '已启用' : '未启用'}
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-500">
                开启后仅回复勾选群；关闭时所有群均可触发。私聊不受此开关限制。
              </div>
            </div>
            <Switch
              checked={filterEnabled}
              onCheckedChange={setFilterEnabled}
            />
          </div>
          {filterEnabled && activeGroups.length === 0 && (
            <Alert className="mx-5 mb-4 border-amber-200 bg-amber-50 text-amber-700">
              <AlertDescription>
                白名单为空：当前会忽略所有群消息。请在下方勾选至少一个群，或关闭白名单。
              </AlertDescription>
            </Alert>
          )}
        </Card>

        {/* 群列表 */}
        <Card className="gap-0 p-0">
          <PanelHeader
            title="群列表"
            description={connected ? '来自 NapCat 的实时群列表。' : 'Bot 未连接 NapCat，当前无法同步实时群列表。'}
            meta={`共 ${groups.length} 个 · 已选 ${activeGroups.length} 个`}
            action={
              <>
              <Button
                variant="outline"
                size="sm"
                onClick={selectAll}
                disabled={groups.length === 0}
              >
                全选
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={selectNone}
                disabled={activeGroups.length === 0}
              >
                全不选
              </Button>
              </>
            }
          />

          {!connected && (
            <Alert className="mx-5 mt-4 border-slate-200 bg-slate-50 text-slate-600">
              <AlertDescription>
                Bot 未连接 NapCat，无法获取实时群列表。请等待连接后刷新。
              </AlertDescription>
            </Alert>
          )}

          {groups.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={connected ? '暂无群列表' : '等待 Bot 连接'}
              description={connected ? '当前账号没有可展示的群，刷新后会重新同步。' : 'NapCat 连接成功后，这里会显示可勾选的群列表。'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>群名</TableHead>
                    <TableHead>群号</TableHead>
                    <TableHead className="text-center">成员数</TableHead>
                    <TableHead className="text-center">启用</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const gid = g.group_id
                    const checked = activeGroups.includes(gid)
                    return (
                      <TableRow
                        key={gid}
                        className={checked ? 'bg-slate-50' : ''}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                              <UsersIcon className="h-4 w-4" />
                            </span>
                            <span className="max-w-[360px] truncate font-medium text-slate-950">
                              {g.group_name || '(未命名)'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">
                          {gid}
                        </TableCell>
                        <TableCell className="text-center text-slate-500">
                          {g.member_count ?? '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleGroup(gid)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
