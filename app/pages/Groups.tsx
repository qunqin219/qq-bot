// 群管理页 —— 群白名单：设置 Bot 仅在指定群回复
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RefreshCwIcon, SaveIcon, UsersIcon } from '../../components/Icons'
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

      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">群白名单</h2>
                <Badge variant={filterEnabled ? 'default' : 'secondary'}>
                  {filterEnabled ? '已启用' : '未启用'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                开启后仅回复勾选群；关闭时所有群均可触发。私聊不受此开关限制。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Switch checked={filterEnabled} onCheckedChange={setFilterEnabled} />
            <Button variant="outline" size="sm" onClick={selectAll} disabled={groups.length === 0}>
              全选
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone} disabled={activeGroups.length === 0}>
              全不选
            </Button>
          </div>
        </div>

        {filterEnabled && activeGroups.length === 0 && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>
              白名单为空：当前会忽略所有群消息。请在下方勾选至少一个群，或关闭白名单。
            </AlertDescription>
          </Alert>
        )}
      </Card>

      {!connected && (
        <Alert className="mb-5 border-border bg-muted text-muted-foreground">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((g) => {
            const gid = g.group_id
            const checked = activeGroups.includes(gid)
            return (
              <div
                key={gid}
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(gid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleGroup(gid)
                  }
                }}
                className="cursor-pointer"
              >
                <Card className={`p-4 transition ${checked ? 'ring-1 ring-primary/30 bg-primary/[0.02]' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                      <UsersIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {g.group_name || '(未命名)'}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{gid}</div>
                      <div className="mt-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {g.member_count ?? '-'} 成员
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <span className={`text-sm ${checked ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {checked ? '已启用' : '未启用'}
                    </span>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleGroup(gid)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </Card>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
