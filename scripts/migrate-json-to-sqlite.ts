#!/usr/bin/env tsx
// JSON → SQLite 数据迁移脚本
//
// 用法：
//   pnpm tsx scripts/migrate-json-to-sqlite.ts
//
// 读取现有的 JSON 存储文件，将数据导入 SQLite 数据库。
// 迁移完成后，原有 JSON 文件会被重命名为 *.bak 以备回滚。

import path from 'node:path';
import fs from 'node:fs';

import { DATA_DIR, MESSAGES_FILE, CONVERSATIONS_FILE, MEMORIES_FILE } from '../lib/server/paths.js';
import { readJsonFile } from '../lib/server/json-store.js';

// 强制使用 SQLite 后端
process.env.QQ_BOT_STORE_BACKEND = 'sqlite';

// 设置数据库路径（默认 data/bot.db）
if (!process.env.QQ_BOT_DB_PATH) {
  process.env.QQ_BOT_DB_PATH = path.join(DATA_DIR, 'bot.db');
}

async function main() {
  console.log('[migrate] 开始 JSON → SQLite 迁移');
  console.log(`[migrate] 数据库路径: ${process.env.QQ_BOT_DB_PATH}`);

  // 加载 SQLite 实现（必须在设置 env 之后）
  const messageStore = await import('../lib/server/store/sqlite/message-store.js');
  const conversationStore = await import('../lib/server/store/sqlite/conversation-store.js');
  const memoryStore = await import('../lib/server/store/sqlite/memory-store.js');

  // ── 迁移消息 ──
  if (fs.existsSync(MESSAGES_FILE)) {
    const messages = readJsonFile(MESSAGES_FILE, [], Array.isArray) as any[];
    const ordered = [...messages].reverse();
    for (const msg of ordered) {
      messageStore.addMessage({
        message_id: msg.message_id,
        user_id: msg.user_id,
        sender: { nickname: msg.nickname, card: msg.group_name },
        message_type: msg.message_type,
        group_id: msg.group_id,
        raw_message: msg.raw_message,
      });
    }
    const messageCount = messages.length;
    console.log(`[migrate] 消息: ${messageCount} 条已导入`);
  } else {
    console.log('[migrate] 消息: 文件不存在，跳过');
  }

  // ── 迁移对话历史 ──
  let convCount = 0;
  if (fs.existsSync(CONVERSATIONS_FILE)) {
    const data = readJsonFile<Record<string, any>>(CONVERSATIONS_FILE, {}, (d): d is Record<string, any> =>
      Boolean(d) && typeof d === 'object' && !Array.isArray(d)
    );
    for (const [key, entry] of Object.entries(data)) {
      const messages = Array.isArray(entry?.messages) ? entry.messages : [];
      for (let i = 0; i < messages.length; i += 2) {
        const userMsg = messages[i];
        const modelMsg = messages[i + 1];
        if (!userMsg || !modelMsg) continue;
        conversationStore.appendTurn(key, userMsg.text || '', modelMsg.text || '', 1000, {
          user_id: userMsg.user_id,
          user_name: userMsg.user_name,
          user_gemini_content: userMsg.gemini_content,
          model_gemini_content: modelMsg.gemini_content,
        });
      }
      convCount++;
    }
    console.log(`[migrate] 对话: ${convCount} 个会话已导入`);
  } else {
    console.log('[migrate] 对话: 文件不存在，跳过');
  }

  // ── 迁移记忆 ──
  if (fs.existsSync(MEMORIES_FILE)) {
    const raw = readJsonFile(MEMORIES_FILE, [], (d): d is any =>
      Array.isArray(d) || (Boolean(d) && typeof d === 'object')
    ) as any;
    const memories = Array.isArray(raw) ? raw : (raw?.memories || []);
    for (const mem of memories) {
      if (!mem?.conversationKey || !mem?.content) continue;
      memoryStore.add(mem.conversationKey, mem.content);
    }
    const memoryCount = memories.length;
    console.log(`[migrate] 记忆: ${memoryCount} 条已导入`);
  } else {
    console.log('[migrate] 记忆: 文件不存在，跳过');
  }

  // ── 验证 ──
  console.log('\n[migrate] 迁移完成，验证数据:');
  console.log(`  消息: ${messageStore.getMessages(1, null, null).length > 0 ? '✅' : '⚠️'} (最新条数: ${messageStore.getMessages(5000, null, null).length})`);
  const histories = conversationStore.listHistories();
  console.log(`  对话: ${histories.length > 0 ? '✅' : '⚠️'} (会话数: ${histories.length})`);
  const allMemories = memoryStore.getAll();
  console.log(`  记忆: ${allMemories.length > 0 ? '✅' : '⚠️'} (总条数: ${allMemories.length})`);

  // ── 备份原文件 ──
  console.log('\n[migrate] 备份原 JSON 文件:');
  for (const file of [MESSAGES_FILE, CONVERSATIONS_FILE, MEMORIES_FILE]) {
    if (fs.existsSync(file)) {
      const bak = `${file}.bak`;
      fs.renameSync(file, bak);
      console.log(`  ${path.basename(file)} → ${path.basename(bak)}`);
    }
  }

  console.log('\n[migrate] 全部完成！下次启动将自动使用 SQLite 后端。');
  process.exit(0);
}

main().catch((e) => {
  console.error('[migrate] 迁移失败:', e);
  process.exit(1);
});
