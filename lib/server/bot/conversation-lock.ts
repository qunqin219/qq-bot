// 按会话（群/私聊）串行化 AI 处理：避免同一会话里近乎同时的两条消息并发读取同一份历史、
// 互相看不到对方那一轮，导致回复错乱或历史写入顺序与实际对话顺序不一致。
const conversationLocks = new Map<string, Promise<void>>();

export async function withConversationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = conversationLocks.get(key) || Promise.resolve();
  let releaseSelf: () => void;
  const selfDone = new Promise<void>((resolve) => { releaseSelf = resolve; });
  // 立刻把自己挂到队尾，这样紧接着到来的第三条消息会排在自己后面，而不是并列排在 previous 后面。
  conversationLocks.set(key, selfDone);
  await previous;
  try {
    return await task();
  } finally {
    releaseSelf!();
    if (conversationLocks.get(key) === selfDone) {
      conversationLocks.delete(key);
    }
  }
}
