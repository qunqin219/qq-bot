// 配置管理 —— JSON 文件持久化管理员列表等配置

import { CONFIG_FILE } from './paths.js';
import { DEFAULT_AI_SYSTEM_PROMPT, normalizeSystemPrompt } from '../shared/system-prompt.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

type BotConfig = {
  admins: Array<number | string>;
  command_prefix: string;
  napcat_ws: string;
  active_groups: Array<number | string>;
  group_filter_enabled: boolean;
  panel_username: string;
  panel_password: string;
  session_secret: string;
  ai_enabled: boolean;
  ai_provider: string;
  ai_base_url: string;
  store_backend: string;
  ai_api_key: string;
  ai_model: string;
  ai_system_prompt: string;
  ai_context_enabled: boolean;
  ai_context_turns: number;
  ai_thinking_enabled: boolean;
  ai_thinking_level: string;
  ai_google_search_enabled: boolean;
  ai_url_context_enabled: boolean;
  ai_allow_group_mention_from_non_admin: boolean;
  ai_group_context_enabled: boolean;
  ai_group_context_messages: number;
  ai_group_context_include_quote: boolean;
  ai_group_context_exclude_bot: boolean;
  ai_filter_stickers: boolean;
  ai_group_reply_quote_enabled: boolean;
  ai_group_reply_quote_prefer_quoted: boolean;
  ai_memory_enabled: boolean;
} & Record<string, unknown>;

// 配置文件位于项目根目录，默认不提交到仓库。

// 默认配置
export const DEFAULT_CONFIG: BotConfig = {
  admins: [],                            // 管理员 QQ 列表；生产环境写入本地 config.json
  command_prefix: '/',                    // 命令前缀
  napcat_ws: 'ws://127.0.0.1:3001',       // NapCat WebSocket 地址
  active_groups: [],                      // 群白名单；启用过滤时为空表示所有群都忽略
  group_filter_enabled: false,            // 是否启用群过滤
  // ── 面板登录配置（不要提交真实密码；生产环境写入 config.json 或环境变量） ──
  panel_username: 'admin',
  panel_password: '',
  session_secret: '',
  // ── AI 回复配置（Gemini API） ─────────────────────
  ai_enabled: false,                      // 是否启用 AI 回复
  ai_provider: 'gemini',                  // AI 提供商：gemini（未来可扩展 openai/claude）
  store_backend: 'sqlite',                // 存储后端：sqlite（默认）/ json。实际由 QQ_BOT_STORE_BACKEND 环境变量控制
  ai_base_url: 'https://generativelanguage.googleapis.com/v1beta', // Gemini API 基础地址
  ai_api_key: '',                         // Gemini API Key
  ai_model: 'gemini-3.5-flash',           // 使用的模型名称
  ai_system_prompt: DEFAULT_AI_SYSTEM_PROMPT, // 系统提示词
  ai_context_enabled: true,               // 是否启用按会话隔离的 AI 上下文
  ai_context_turns: 10,                   // 每个会话保留的上下文轮数
  ai_thinking_enabled: true,              // 是否显式设置 Gemini 3.5 思考程度
  ai_thinking_level: 'medium',            // 思考程度：low / medium / high
  ai_google_search_enabled: false,        // 是否启用 Gemini 内置 Google Search
  ai_url_context_enabled: false,          // 是否启用 Gemini URL context 网页上下文
  ai_allow_group_mention_from_non_admin: false, // 是否允许群内非管理员 @bot 触发 AI
  ai_group_context_enabled: true,        // 群聊 @bot 时是否附带最近群消息上下文
  ai_group_context_messages: 20,         // 最近群消息上下文条数
  ai_group_context_include_quote: true,  // 是否优先解析 QQ 引用消息
  ai_group_context_exclude_bot: true,    // 最近群消息上下文是否排除 bot 自己的消息
  ai_filter_stickers: true,              // 是否过滤 QQ 表情包/动画表情，避免污染 AI 上下文
  ai_group_reply_quote_enabled: true,    // 群聊 AI 回复时是否引用消息（不额外 @）
  ai_group_reply_quote_prefer_quoted: true, // 如果用户本身引用了消息，优先引用被引用消息
  ai_memory_enabled: true,               // 是否启用按会话隔离的个性化记忆
};

/**
 * 读取配置，不存在则写入默认配置。
 * 与现有文件合并，避免新增字段缺失。
 */
function isConfigObject(data: unknown): data is Partial<BotConfig> & Record<string, unknown> {
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data);
}

export function loadConfig(): BotConfig {
  const cfg = readJsonFile<Partial<BotConfig> & Record<string, unknown> | null>(CONFIG_FILE, null, isConfigObject);
  if (cfg) {
    // 合并默认值
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    return {
      ...merged,
      ai_system_prompt: normalizeSystemPrompt(merged.ai_system_prompt),
    };
  }
  // 文件不存在，写入默认配置
  saveConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置到 JSON 文件。
 */
export function saveConfig(cfg: Partial<BotConfig> & Record<string, unknown>): void {
  // 不再主动写入旧固定自动回复字段；已有 config.json 中的旧字段仅在读取合并时兼容。
  const cleanCfg = { ...cfg };
  delete cleanCfg.auto_reply;
  delete cleanCfg.reply_text;
  writeJsonFileAtomic(CONFIG_FILE, cleanCfg);
}
