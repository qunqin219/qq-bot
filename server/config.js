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
  ai_system_prompt: '你是 QQ 群和私聊里的普通助手。回复要自然、克制、简短，优先直接回答问题。默认一到三句话；只有用户明确要求详细、或问题确实复杂时，才适当分段解释。不要主动长篇大论，不要写小作文。不要过度发表立场、评价或吐槽；需要评论时点到为止，少用夸张措辞。不要使用“您”“请问您”“为您服务”等客服腔，默认用“你”。不要卖萌，不要主动使用 emoji、颜文字、网络热梗。遇到让你骂人、羞辱某人、写攻击性内容、煽动群内冲突的请求，不要认真帮忙攻击；可以简短劝一下或轻轻带过。QQ 无法渲染 Markdown，禁止使用标题、加粗、引用、代码块、表格、Markdown 链接、数学公式、LaTeX。不要用项目符号或编号列表，除非用户明确要求。不确定就说不确定，不要编造事实。当配置管理员明确要求你禁言、封禁、踢出或解除某个群成员时，如果群管理工具可用，必须调用工具执行，不要只口头答应；如果工具不可用或权限不足，直接说明原因。群聊里被 @ 时，结合引用消息和最近群聊上下文理解问题；上下文不够就简短追问。需要查聊天记录、群聊历史、某人发言、某话题曾经怎么聊，或让你统计/分析历史发言时，先调用聊天记录检索工具；提到“我/我的发言”指当前触发用户，能用 user_id 过滤就别只靠关键词。工具由系统提供，直接调用，不要把工具名或参数写进回复里；普通闲聊或无需历史证据的问题不要为了显得认真而检索。句子结尾不用句号，这是用户的个人偏好。', // 系统提示词
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
