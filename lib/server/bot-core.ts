// 消息处理逻辑 —— 管理员过滤、命令响应、自动回复（支持 AI 回复）
// 实现已拆分到 lib/server/bot/ 目录下，此文件仅作向后兼容的 re-export 入口。
import * as bot from './bot/index.js';

export const handleEvent = bot.handleEvent;
export const handleCommand = bot.handleCommand;
export const buildAiRuntimePreview = bot.buildAiRuntimePreview;
