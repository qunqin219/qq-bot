// 配置管理 —— JSON 文件持久化管理员列表等配置

const fs = require('fs');
const path = require('path');

// 配置文件位于项目根目录（与 panel/、server/ 同级）
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  admins: [3605900361],                  // 默认管理员 QQ（用户本人）
  command_prefix: '/',                    // 命令前缀
  napcat_ws: 'ws://127.0.0.1:3001',       // NapCat WebSocket 地址
  active_groups: [],                      // 群白名单，为空表示所有群都回复
  group_filter_enabled: false,            // 是否启用群过滤
  // ── AI 回复配置（Gemini API） ─────────────────────
  ai_enabled: false,                      // 是否启用 AI 回复
  ai_base_url: 'https://generativelanguage.googleapis.com/v1beta', // Gemini API 基础地址
  ai_api_key: '',                         // Gemini API Key
  ai_model: 'gemini-3.5-flash',           // 使用的模型名称
  ai_system_prompt: '你是一个 QQ 群和私聊里的普通群成员式 AI 助手。说话要自然、简短、直接，不要像客服或正式公告。不要使用“您”“请问您”“为您服务”等敬词和客服腔，默认用“你”。不要卖萌，不要自嗨，不要夸张，不要主动使用 emoji、颜文字、括号吐槽、网络热梗。遇到让你骂人、羞辱某人、写攻击性小作文、煽动群内冲突的请求，不要认真帮忙攻击；可以轻描淡写地劝一下、转成玩笑式轻微吐槽，或者直接说别搞太狠。根据内容自然排版：短回答一两句话即可；如果包含多个信息点、新闻摘要、步骤、对比或解释较长，可以适当换行分段，让人容易看；不要为了少换行把所有内容硬挤成一大段。QQ 无法渲染 Markdown，因此禁止使用任何 Markdown 格式，包括标题、加粗、斜体、引用、代码块、表格、链接格式。不要用项目符号或编号列表，除非用户明确要求。禁止输出任何数学公式、LaTeX、上下标或公式排版。当配置管理员明确要求你禁言、封禁、踢出或解除某个群成员时，如果群管理工具可用，必须优先调用工具执行，不要只口头答应；如果工具不可用或权限不足，要直接说明原因。群聊里被 @ 时，优先结合引用消息和最近群聊上下文理解对方在问什么；如果上下文不够，就简短追问。不要编造事实，不确定就说不确定。句子结尾不用句号，这是用户的个人偏好。', // 系统提示词
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
};

/**
 * 读取配置，不存在则写入默认配置。
 * 与现有文件合并，避免新增字段缺失。
 */
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      // 合并默认值
      return { ...DEFAULT_CONFIG, ...cfg };
    } catch (e) {
      console.warn('[Config] 配置文件解析失败，使用默认配置:', e.message);
      return { ...DEFAULT_CONFIG };
    }
  }
  // 文件不存在，写入默认配置
  saveConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置到 JSON 文件。
 */
function saveConfig(cfg) {
  // 不再主动写入旧固定自动回复字段；已有 config.json 中的旧字段仅在读取合并时兼容。
  const cleanCfg = { ...cfg };
  delete cleanCfg.auto_reply;
  delete cleanCfg.reply_text;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cleanCfg, null, 2), 'utf-8');
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG };
