import type { ToolDeclarationOptions } from '../types.js';

function buildGroupManagementFunctionDeclarations(options: ToolDeclarationOptions = {}): Array<Record<string, any>> {
  const declarations: Array<Record<string, any>> = [];
  if (options.imageReadEnabled) {
    declarations.push({
      name: 'qq_read_image',
      description: '按需读取当前 QQ 群上下文中的图片内容。只有当前问题确实需要看图、识别截图、解释图片、或用户明确指向某张图片时才调用。优先使用上下文 images 里的 image_key；也可以用 message_id 和 image_index 读取某条消息的第几张图。',
      parameters: {
        type: 'object',
        properties: {
          image_key: { type: 'string', description: '上下文 images 数组里的 image_key，最精确' },
          message_id: { type: 'integer', description: '包含图片的群消息 message_id' },
          image_index: { type: 'integer', description: '同一条消息里的第几张图片，从 1 开始。默认 1' },
          reason: { type: 'string', description: '为什么需要读取这张图片，简短说明' },
        },
      },
    });
  }
  if (options.memoryEnabled) {
    declarations.push(
      {
        name: 'create_memory',
        description: 'create a memory record',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The content of the memory record' },
          },
          required: ['content'],
        },
      },
      {
        name: 'edit_memory',
        description: 'update a memory record',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'The id of the memory record' },
            content: { type: 'string', description: 'The content of the memory record' },
          },
          required: ['id', 'content'],
        },
      },
      {
        name: 'delete_memory',
        description: 'delete a memory record',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'The id of the memory record' },
          },
          required: ['id'],
        },
      }
    );
  }
  if (options.memberListEnabled) {
    declarations.push({
      name: 'qq_get_group_members',
      description: '获取当前 QQ 群所有群成员的 QQ 号、昵称、群名片和身份。用于查找用户提到的成员，或回答当前群成员列表相关问题。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '可选。按昵称、群名片或 QQ 号过滤成员；不填则返回当前群全部成员' },
        },
      },
    });
  }

  if (!options.managementEnabled) return declarations;

  declarations.push(
    {
      name: 'qq_set_group_whole_ban',
      description: '开启或关闭当前 QQ 群的全员禁言。用户说"开启群禁言/全员禁言/全群禁言/关闭群禁言"时使用。',
      parameters: {
        type: 'object',
        properties: {
          enable: { type: 'boolean', description: 'true 开启全员禁言，false 关闭全员禁言' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['enable'],
      },
    },
    {
      name: 'qq_mute_all_manageable_members',
      description: '批量禁言当前群里 bot 有权限操作的普通成员。用户说"把群里所有人都禁言/给所有人上X分钟"时使用；不要用于"开启全员禁言"这种群开关。',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: { type: 'integer', description: '禁言秒数。未说明时用 600 秒，最长 2592000 秒' },
          reason: { type: 'string', description: '简短原因' },
        },
      },
    },
    {
      name: 'qq_unmute_all_manageable_members',
      description: '批量解除当前群里 bot 有权限操作的普通成员禁言。用户说"把所有禁言都解开/给所有人解禁"时使用。',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '简短原因' },
        },
      },
    },
    {
      name: 'qq_mute_member',
      description: '禁言当前 QQ 群中的某个成员。只在 bot 是管理员或群主，且触发者有权限时可执行。',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要禁言的目标 QQ 号' },
          duration_seconds: { type: 'integer', description: '禁言秒数。未说明时用 600 秒，最长 2592000 秒' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    },
    {
      name: 'qq_unmute_member',
      description: '解除当前 QQ 群中某个成员的禁言',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要解除禁言的目标 QQ 号' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    },
    {
      name: 'qq_kick_member',
      description: '把当前 QQ 群中的某个成员移出群。只有用户明确要求踢人/移出群时才使用',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要踢出的目标 QQ 号' },
          reject_add_request: { type: 'boolean', description: '是否拒绝此人后续加群请求，默认 false' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    }
  );

  return declarations;
}

export { buildGroupManagementFunctionDeclarations };
