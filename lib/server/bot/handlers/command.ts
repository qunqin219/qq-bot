import type { BotConfig, OneBotClient, OneBotEvent } from '../types.js';

import { conversationStore } from '../../store/index.js';

/**
 * 处理管理员命令。
 */
async function handleCommand(
  cmd: string,
  event: OneBotEvent,
  client: OneBotClient,
  _cfg?: BotConfig
): Promise<void> {
  const userId = event.user_id;
  const groupId = event.group_id;

  async function reply(text: string): Promise<void> {
    if (groupId) {
      await client.sendGroupMsg!(groupId, text);
    } else {
      await client.sendPrivateMsg!(userId as any, text);
    }
  }

  cmd = cmd.trim();
  if (!cmd) return;
  const parts = cmd.split(/\s+/);
  const name = parts[0].toLowerCase();

  if (name === 'ping') {
    await reply('pong! 🏓');
  } else if (name === 'status') {
    const info = await client.getLoginInfo!();
    const data = (info && info.data) || {};
    await reply(
      'Bot 运行中\n' +
      `QQ: ${data.user_id}\n` +
      `昵称: ${data.nickname}\n` +
      `连接: ${client.connected ? '✅ 在线' : '❌ 离线'}`
    );
  } else if (name === 'clearcontext' || name === 'clearctx') {
    const key = conversationStore.getConversationKey(event);
    conversationStore.clearHistory(key);
    await reply('已清空当前上下文');
  } else if (name === 'help') {
    await reply(
      '命令列表:\n' +
      '/ping - 测试\n' +
      '/status - 状态\n' +
      '/clearcontext - 清空当前会话上下文\n' +
      '/clearctx - 清空当前会话上下文\n' +
      '/help - 帮助'
    );
  } else {
    await reply(`未知命令: ${name}\n发送 /help 查看帮助`);
  }
}

export { handleCommand };
