import type { AgentRunStore } from '../types.js';
import { jsonAgentRunStore } from './json.js';
import { sqliteAgentRunStore } from './sqlite.js';

function selectedStore(): AgentRunStore {
  return String(process.env.QQ_BOT_STORE_BACKEND || '').trim().toLowerCase() === 'json'
    ? jsonAgentRunStore
    : sqliteAgentRunStore;
}

export const agentRunStore = new Proxy({} as AgentRunStore, {
  get(_target, prop, receiver) {
    return Reflect.get(selectedStore(), prop, receiver);
  },
});
