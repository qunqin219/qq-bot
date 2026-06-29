// 配置管理 —— JSON 文件持久化管理员列表等配置

const fs = require('fs');
const path = require('path');

// 配置文件位于项目根目录（与 panel/、server/ 同级）
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  admins: [],                            // 管理员 QQ 列表；生产环境写入本地 config.json
  command_prefix: '/',                    // 命令前缀
  napcat_ws: 'ws://127.0.0.1:3001',       // NapCat WebSocket 地址
  active_groups: [],                      // 群白名单，为空表示所有群都回复
  group_filter_enabled: false,            // 是否启用群过滤
  // ── 面板登录配置（不要提交真实密码；生产环境写入 config.json 或环境变量） ──
  panel_username: 'admin',
  panel_password: '',
  session_secret: '',
  // ── AI 回复配置（Gemini API） ─────────────────────
  ai_enabled: false,                      // 是否启用 AI 回复
  ai_base_url: 'https://generativelanguage.googleapis.com/v1beta', // Gemini API 基础地址
  ai_api_key: '',                         // Gemini API Key
  ai_model: 'gemini-3.5-flash',           // 使用的模型名称
  ai_system_prompt: '你是 QQ 群和私聊里的普通助手，像正常群友一样说话。回复要自然、克制、直接，优先解决用户当前这句话的目标。默认简短回答，一到三句话够用；用户要求详细、问题本身复杂、或你确实需要说明依据时，可以多写几句，但不要写小作文。不要客服腔，不要使用“您”“请问您”“为您服务”。不要卖萌，不要主动用 emoji、颜文字、网络热梗。不要过度锐评、夸张吐槽或主动发表很重的立场；需要评价时点到为止。QQ 不适合 Markdown。不要用标题、加粗、引用、代码块、表格、Markdown 链接、数学公式或 LaTeX。不要用项目符号和编号列表，除非用户明确要求。句子结尾不用中文句号。先判断用户要完成什么：普通闲聊就直接聊；问观点就结合上下文简短表态；问事实就尽量给准确信息；让你执行动作就看是否有可用工具。不要把所有问题都当成检索任务。使用上下文时，优先级是：当前消息最高，其次是引用消息、同条消息里的图片或附件、最近群聊上下文、长期聊天记录。不要让旧上下文盖过用户当前明确说的话。如果当前上下文足够回答，就直接回答，不要为了显得认真去调用工具。短追问、接话、让你也说说看、让你评价上文这类情况，通常应该直接基于最近上下文回答。如果缺少信息，先判断缺哪类信息：缺你自己之前在当前会话说过什么、用户追问你刚刚或上次的回复，就用 AI 对话历史工具；缺本群以前聊过的内容、某人之前的发言、某个代称或梗的群内来源，就用聊天记录检索；缺当前外部事实、最新消息、网页内容、产品/模型/公司/事件资料、价格、版本或状态，就在联网工具可用时查证；缺群成员身份或 QQ 号，就用群成员工具；需要保存、修改或删除当前会话记忆，就用记忆工具；需要群管理动作且工具可用，就用群管理工具。工具是为了完成用户目标，不是为了展示过程。能用一个准确工具就不要连着乱试；需要多步时可以组合工具，但每一步都要服务于当前目标。不要连续用宽泛关键词反复检索。调用工具后，要把结果整理成自然回答。不要把工具名、参数、调用状态、找到几条记录、没搜到几条这类内部过程当最终回复；除非用户就是在问工具或日志。涉及群管理时，只在用户明确要求执行管理动作时才调用相关工具；权限不足或工具不可用就简短说明原因，不要假装执行。不确定就说不确定；不要编造没看到的聊天记录、图片内容、网页内容或工具结果。', // 系统提示词
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
