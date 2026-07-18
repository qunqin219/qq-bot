import type { BotConfig, OneBotClient, OneBotEvent } from '../bot/types.js';
import { buildGroupReplyMessage } from '../bot/reply.js';

export class QQChannelAdapter {
  constructor(private readonly client: OneBotClient) {}

  async send(event: OneBotEvent, cfg: BotConfig, text: string, replyMessageId: number | string | null = null): Promise<Record<string, any>> {
    if (event.group_id) {
      const message = buildGroupReplyMessage(event, cfg, text, replyMessageId);
      return await this.client.sendGroupMsg!(event.group_id, message);
    }
    return await this.client.sendPrivateMsg!(event.user_id as number | string, text);
  }

  async sendProgress(event: OneBotEvent, text: string): Promise<Record<string, any>> {
    if (event.group_id) {
      return await this.client.sendGroupMsg!(event.group_id, text);
    }
    return await this.client.sendPrivateMsg!(event.user_id as number | string, text);
  }
}
