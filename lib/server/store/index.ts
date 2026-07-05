// 存储工厂 —— 根据 QQ_BOT_STORE_BACKEND 环境变量选择后端
//
// 'sqlite' (默认): 使用 SQLite 数据库
// 'json':          使用原有 JSON 文件存储（测试和向后兼容）
//
// 通过 process.env 控制（而非 config）以避免循环依赖。
// ESM 模式下使用静态 import 加载两个后端，运行时选择。
// 使用 Proxy 实现惰性选择 —— 每次属性访问时读取最新 env var，
// 这样测试可以在 import 之后设置 QQ_BOT_STORE_BACKEND。

import * as jsonMessage from '../message-store.js';
import * as jsonConversation from '../conversation-store.js';
import * as jsonMemory from '../memory-store.js';
import * as sqliteMessage from './sqlite/message-store.js';
import * as sqliteConversation from './sqlite/conversation-store.js';
import * as sqliteMemory from './sqlite/memory-store.js';

type StoreBackend = 'sqlite' | 'json';

function getBackend(): StoreBackend {
  const backend = String(process.env.QQ_BOT_STORE_BACKEND || '').trim().toLowerCase();
  return backend === 'json' ? 'json' : 'sqlite';
}

function lazyStore(jsonStore: object, sqliteStore: object): any {
  return new Proxy({}, {
    get(_target, prop, receiver) {
      const store = getBackend() !== 'json' ? sqliteStore : jsonStore;
      return Reflect.get(store, prop, receiver);
    },
  });
}

export const messageStore = lazyStore(jsonMessage, sqliteMessage);
export const conversationStore = lazyStore(jsonConversation, sqliteConversation);
export const memoryStore = lazyStore(jsonMemory, sqliteMemory);

export { getBackend };
