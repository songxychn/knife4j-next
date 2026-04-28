# Pipedream Workflow 配置说明

本文档描述如何在 Pipedream 上搭建 Telegram → GitHub Issue 的自动化工作流，用于将 IM 消息转化为结构化 agent 任务。

---

## 工作流概览

```
TG Bot Trigger
    ↓
Anthropic 解析（提取 title / body / area / priority）
    ↓
GitHub Create Issue（附加 labels）
    ↓
TG Reply（回复 issue 链接）
    ↓
（可选）Webhook 回播
```

---

## Step 1：Telegram Bot Trigger

**类型**：Pipedream 内置 Telegram Bot trigger（`telegram-bot-new-message`）

**配置项**：

| 字段 | 说明 |
|------|------|
| Bot Token | 从 BotFather 获取，存入 Pipedream Environment Variable，**不要硬编码** |
| Allowed Chat IDs | 白名单列表（见安全规则），存入 Environment Variable |

**输出**：`steps.trigger.event.message`，包含 `chat.id`、`from.id`、`text` 等字段。

**白名单校验**（在此步骤或 Step 2 前置过滤）：

```javascript
const allowedChatIds = process.env.TG_ALLOWED_CHAT_IDS
  .split(",")
  .map(id => id.trim());

const chatId = steps.trigger.event.message.chat.id.toString();
if (!allowedChatIds.includes(chatId)) {
  $flow.exit("chat_id not in whitelist");
}
```

---

## Step 2：Anthropic 解析

**类型**：Node.js code step（使用 `@anthropic-ai/sdk`）

**目的**：将自然语言消息解析为结构化 JSON，供后续步骤使用。

### System Prompt 模板

```
你是一个任务提取助手。用户会发送一段自然语言描述，描述一个软件问题或功能需求。

请从中提取以下字段，以 JSON 格式输出，不要输出任何其他内容：

{
  "title": "简洁的任务标题（不超过 80 字符）",
  "body": "详细描述，保留原始上下文，使用 Markdown 格式",
  "area": "任务所属模块，只能是以下之一：java / ui-react / front-core / docs / repo",
  "priority": "优先级，只能是以下之一：P0 / P1 / P2 / P3"
}

规则：
- title 必须是英文或中文，简洁明了
- body 应包含问题背景、复现步骤（如有）、期望行为
- area 根据描述内容判断，无法判断时填 repo
- priority 根据影响范围和紧急程度判断，无法判断时填 P2
- 只输出 JSON，不要有任何前缀或后缀文字
```

### 代码示例

```javascript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const userMessage = steps.trigger.event.message.text;

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: SYSTEM_PROMPT, // 见上方模板
  messages: [{ role: "user", content: userMessage }],
});

const parsed = JSON.parse(response.content[0].text);
export default parsed; // { title, body, area, priority }
```

---

## Step 3：GitHub Create Issue

**类型**：Pipedream 内置 GitHub action（`github-create-issue`）或 Node.js code step（使用 Octokit）

**配置项**：

| 字段 | 值 |
|------|----|
| Repo | `your-org/knife4j-next`（替换为实际仓库） |
| Title | `steps.anthropic_parse.$return_value.title` |
| Body | 见下方 Issue Body 模板 |
| Labels | `agent-task,status:ready,source:im,area:<x>` |

### Issue Body 模板

```markdown
<!-- source:im -->

## 任务描述

{steps.anthropic_parse.$return_value.body}

---

## 元数据

| 字段 | 值 |
|------|----|
| 来源 | IM（Telegram） |
| 优先级 | {steps.anthropic_parse.$return_value.priority} |
| 模块 | {steps.anthropic_parse.$return_value.area} |
| 提交时间 | {new Date().toISOString()} |

---

## 原始请求

> {steps.trigger.event.message.text}

---

*此 Issue 由 Pipedream 工作流自动创建。*
```

### 必需 Labels

创建 Issue 时必须附加以下 labels（labels 需提前在 GitHub 仓库中创建）：

| Label | 含义 |
|-------|------|
| `agent-task` | 标记为 agent 自动维护的任务 |
| `status:ready` | 可被 agent 拾取 |
| `source:im` | 来源为 IM 消息 |
| `area:<x>` | 替换为实际模块，如 `area:java`、`area:docs` |

---

## Step 4：Telegram Reply

**类型**：Pipedream 内置 Telegram Bot action（`telegram-bot-send-message`）或 Node.js code step

**目的**：将创建的 GitHub Issue 链接回复给用户。

```javascript
const issueUrl = steps.github_create_issue.$return_value.html_url;
const issueNumber = steps.github_create_issue.$return_value.number;
const title = steps.anthropic_parse.$return_value.title;

const text = `✅ Issue 已创建：\n\n#${issueNumber} ${title}\n${issueUrl}`;

await axios.post(
  `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,
  {
    chat_id: steps.trigger.event.message.chat.id,
    text,
    parse_mode: "HTML",
  }
);
```

---

## Step 5（可选）：Webhook 回播

**类型**：Node.js code step（HTTP POST）

**目的**：将事件推送到内部系统（如 OpenClaw / OpenHands 调度器）。

```javascript
const payload = {
  event: "issue_created",
  issue_number: steps.github_create_issue.$return_value.number,
  issue_url: steps.github_create_issue.$return_value.html_url,
  area: steps.anthropic_parse.$return_value.area,
  priority: steps.anthropic_parse.$return_value.priority,
  source: "im",
  timestamp: new Date().toISOString(),
};

await axios.post(process.env.INTERNAL_WEBHOOK_URL, payload, {
  headers: { Authorization: `Bearer ${process.env.INTERNAL_WEBHOOK_TOKEN}` },
});
```

---

## 安全规则

### 1. Telegram Chat ID 白名单

- 只允许预先配置的 `chat_id` 触发工作流。
- 白名单存储在 Pipedream Environment Variable `TG_ALLOWED_CHAT_IDS`，格式为逗号分隔的数字字符串。
- **不要在代码或文档中硬编码任何真实 chat_id。**
- 非白名单消息直接调用 `$flow.exit()` 终止，不产生任何副作用。

### 2. 每日 Issue 上限

- 使用 Pipedream Data Store 记录每日创建数量。
- 建议上限：每个 chat_id 每日不超过 **10 个** Issue，全局不超过 **50 个**。
- 超出上限时回复用户提示，不创建 Issue。

```javascript
const store = await $.service.db;
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const key = `issue_count_${today}`;
const count = (await store.get(key)) || 0;

const DAILY_LIMIT = 50;
if (count >= DAILY_LIMIT) {
  // 回复用户并终止
  $flow.exit("daily_limit_exceeded");
}
await store.set(key, count + 1);
```

### 3. 关键词黑名单

以下关键词出现在消息中时，**拒绝处理**并回复用户说明原因：

| 关键词 | 原因 |
|--------|------|
| `release` | 发布操作需人工审批 |
| `delete module` | 删除模块属于破坏性操作 |
| `force push` | 强制推送需人工确认 |

```javascript
const BLACKLIST = ["release", "delete module", "force push"];
const text = steps.trigger.event.message.text.toLowerCase();

for (const keyword of BLACKLIST) {
  if (text.includes(keyword)) {
    // 回复用户并终止
    $flow.exit(`blocked_keyword: ${keyword}`);
  }
}
```

---

## Environment Variables 清单

| 变量名 | 说明 | 是否必需 |
|--------|------|----------|
| `TG_BOT_TOKEN` | Telegram Bot Token | 必需 |
| `TG_ALLOWED_CHAT_IDS` | 白名单 chat_id，逗号分隔 | 必需 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 必需 |
| `GITHUB_TOKEN` | GitHub Personal Access Token（需 `issues:write` 权限） | 必需 |
| `GITHUB_REPO` | 目标仓库，格式 `owner/repo` | 必需 |
| `INTERNAL_WEBHOOK_URL` | 内部回播地址（Step 5 可选） | 可选 |
| `INTERNAL_WEBHOOK_TOKEN` | 内部回播鉴权 Token（Step 5 可选） | 可选 |

> ⚠️ 所有敏感值必须通过 Pipedream Environment Variables 管理，**严禁硬编码到工作流代码中**。

---

## 参考

- [Pipedream Docs](https://pipedream.com/docs)
- [Anthropic API Docs](https://docs.anthropic.com)
- [GitHub REST API - Create Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)
- [Telegram Bot API - sendMessage](https://core.telegram.org/bots/api#sendmessage)
