// Gemini AI 调用模块 —— generateContent 兼容格式，支持文字 + QQ 图片识别
//
// 实现已拆分到 ai/ 目录下，此文件仅作向后兼容的 re-export 入口：
//   ai/chat.ts            - 工具循环主逻辑（模型无关，通过 LLMProvider 接口）
//   ai/utils.ts           - 模型无关工具函数（CQ码处理、文本格式化等）
//   ai/sanitize.ts        - 思维链泄漏检测与清洗
//   ai/retry.ts           - HTTP 重试基础设施
//   ai/provider.ts        - LLMProvider 接口定义
//   ai/types.ts           - 类型定义和常量
//   ai/gemini/provider.ts - GeminiProvider（LLMProvider 实现）
//   ai/gemini/request.ts  - Gemini 请求体构建
//   ai/gemini/response.ts - Gemini 响应解析
//   ai/gemini/image.ts    - Gemini 图片 inline_data 转换

import { chat as _chat } from './ai/chat.js';
import { stripCqCodes, extractImageUrls, isStickerMessage } from './ai/utils.js';
import { buildRequestBody } from './ai/gemini/request.js';

// 可变持有者 —— ESM 模式下 export 的命名绑定是只读的，
// 但对象属性可以修改，测试通过 _overrideChat / _restoreChat 来 mock chat。
const _holders = {
  chat: _chat,
};

export async function chat(...args: Parameters<typeof _chat>): Promise<ReturnType<typeof _chat>> {
  return _holders.chat(...args);
}

export function _overrideChat(fn: typeof _chat): typeof _chat {
  const old = _holders.chat;
  _holders.chat = fn;
  return old;
}

export function _restoreChat(fn: typeof _chat): void {
  _holders.chat = fn;
}

export {
  stripCqCodes,
  extractImageUrls,
  isStickerMessage,
  buildRequestBody,
};
