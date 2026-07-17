// 群管理 —— 工具条 + 可勾选表格
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import {
  Loading,
  ErrorBox,
  PageHeader,
  DataPanel,
  Toolbar,
  EmptyState,
  StatusDot,
  useToast,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RefreshCwIcon, SaveIcon, UsersIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
import type { GroupInfo } from '../../lib/shared/types'

export default function Groups() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [activeGroups, setActiveGroups] = useState<Array<number | string>>([])
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [connected, setConnected] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, groupsData] = await Promise.all([api.getConfig(), api.getGroups()])
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

  const selectAll = () => setActiveGroups(groups.map((g) => g.group_id))
  const selectNone = () => setActiveGroups([])

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
        subtitle="白名单：开启后仅回复勾选群（私聊不受限）"
        action={
          <>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={saving}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : <><SaveIcon className="h-4 w-4" /> 保存</>}
            </Button>
          </>
        }
      />
      {ToastEl}

      <DataPanel>
        <Toolbar>
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot ok={connected} label={connected ? 'Synced' : 'Offline'} />
            <div className="h-4 w-px bg-border" />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={filterEnabled} onCheckedChange={setFilterEnabled} />
              <span className={filterEnabled ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                启用白名单
              </span>
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              selected {activeGroups.length} / {groups.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="xs" onClick={selectAll} disabled={groups.length === 0}>
              全选
            </Button>
            <Button variant="outline" size="xs" onClick={selectNone} disabled={activeGroups.length === 0}>
              清空
            </Button>
          </div>
        </Toolbar>

        {filterEnabled && activeGroups.length === 0 && (
          <Alert variant="destructive" className="m-3">
            <AlertDescription>
              白名单为空：当前会忽略所有群消息。请勾选至少一个群，或关闭白名单。
            </AlertDescription>
          </Alert>
        )}

        {!connected && (
          <Alert className="m-3 border-border bg-muted text-muted-foreground">
            <AlertDescription>
              Bot 未连接 NapCat，无法获取实时群列表。连接后请刷新。
            </AlertDescription>
          </Alert>
        )}

        {groups.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={connected ? '暂无群列表' : '等待 Bot 连接'}
            description={
              connected
                ? '当前账号没有可展示的群。'
                : 'NapCat 连接成功后，这里会显示可勾选的群。'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono">群名</TableHead>
                  <TableHead className="font-mono">群号</TableHead>
                  <TableHead className="font-mono text-right">成员</TableHead>
                  <TableHead className="w-24 font-mono text-right">启用</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const checked = activeGroups.includes(g.group_id)
                  return (
                    <TableRow
                      key={g.group_id}
                      className={cn('cursor-pointer', checked && 'bg-teal-50/50')}
                      onClick={() => toggleGroup(g.group_id)}
                    >
                      <TableCell className="max-w-[240px] truncate font-medium">
                        {g.group_name || '(未命名)'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {g.group_id}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {g.member_count ?? '—'}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex justify-end">
                          <Switch
                            checked={checked}
                            onCheckedChange={() => toggleGroup(g.group_id)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DataPanel>
    </div>
  )
}
