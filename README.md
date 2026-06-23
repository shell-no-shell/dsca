# DS-CodeAgent (dsca)

基于 DeepSeek 模型的 AI 编程助手 —— 一个可以在终端中自主分析代码库、制定计划并执行编码任务的命令行工具与 SDK。

## 特性

- **两种执行模式**
  - `auto`：全自动模式。生成计划后自动批准并逐步执行,无需人工干预。
  - `plan`：交互式计划模式。先生成执行计划,在终端给出选项,你可以**批准执行、逐步执行、输入自己的需求修改计划,或取消**,然后继续任务。
- **18 个内置工具**:文件读写/编辑、目录列举、代码搜索、shell 执行、测试运行、git 操作、HTTP 请求、网页搜索等(见下文)。
- **工具自动筛选**:根据任务自动选择相关工具加载完整 schema,其余工具以紧凑目录形式延迟加载,节省上下文 token。
- **MCP 支持**:可接入外部 MCP(Model Context Protocol)工具服务器。
- **上下文压缩**:接近上下文窗口上限时自动压缩历史消息。
- **会话历史与长期记忆**:记录每次会话,并从完成的会话中提取可复用的记忆。
- **安全沙箱**:对危险操作(删除文件、shell 命令等)进行确认拦截,可配置允许域名 / 屏蔽命令。
- **成本统计**:每次运行结束输出 token 用量与预估费用。

## 项目结构

这是一个基于 [Turborepo](https://turbo.build/) 的 monorepo:

```
packages/
  core/    @dsca/core   —— 核心编排引擎(Agent、LLM 客户端、Prompt、上下文、会话、沙箱)
  tools/   @dsca/tools  —— 工具注册表与 18 个内置工具,以及 MCP 适配器
  cli/     ds-code-agent-cli —— 命令行入口(bin: dsca)
  sdk/     @dsca/sdk    —— 面向 Node.js 的编程式 SDK,重导出 core/tools 的公共 API
```

## 环境要求

- Node.js >= 18
- 一个 DeepSeek API Key

## 安装与构建

```bash
# 安装依赖(monorepo 工作区)
npm install

# 构建所有包
npm run build

# 运行测试
npm test
```

## 配置

### API Key

在仓库根目录创建 `.env` 文件:

```env
DEEPSEEK_API_KEY=你的_api_key
```

也支持通过环境变量 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`,或写入配置文件(见下)。

### 配置文件(可选)

配置优先级:命令行参数 > 项目配置 `.dsca.yaml` > 全局配置 `~/.dsca/config.yaml` > 默认值。

```yaml
# ~/.dsca/config.yaml 或 项目根目录 .dsca.yaml
llm:
  provider: deepseek
  baseUrl: https://api.deepseek.com/v1
  defaultModel: deepseek-chat
  temperature: 0.2
  maxTokens: 8192
agent:
  defaultMode: auto
  maxSteps: 30
security:
  sandboxEnabled: true
  allowedDomains: []
  blockedCommands: []
mcp:
  servers: []
```

## 使用方式

构建后可直接通过 Node 运行 CLI,或将其链接为全局 `dsca` 命令。

```bash
# 方式一:直接运行
node packages/cli/dist/index.js <command> [options]

# 方式二:链接为全局命令 dsca
cd packages/cli && npm link
# 之后即可:
dsca <command> [options]
```

### auto 模式(默认)

```bash
dsca "给 calculator.py 的 divide() 加上除零检查,抛出 ValueError" -w ./my_project
```

### plan 模式(交互式)

```bash
dsca plan "重构用户认证模块" -w ./my_project
```

运行后流程:

1. 生成并打印执行计划。
2. 终端弹出选项,输入数字选择:
   1. **批准并执行全部** —— 一次性跑完整个计划
   2. **逐步执行** —— 每完成一步后暂停,询问下一步操作
   3. **修改计划 / 输入自己的需求** —— 输入一段文字补充需求,计划会重新生成,可反复修改
   4. **取消**
3. 选择 1 或 2 后开始执行;执行中危险操作会请求确认(可用 `--confirm-all` 跳过)。

### 常用全局选项

| 选项 | 说明 |
| --- | --- |
| `-m, --model <model>` | 指定模型(默认 `deepseek-chat`) |
| `-w, --workspace <path>` | 工作目录(默认当前目录) |
| `--max-steps <n>` | 最大执行步数 |
| `--temperature <t>` | 生成温度 |
| `--no-sandbox` | 关闭安全沙箱 |
| `--confirm-all` | 自动确认所有操作 |
| `-v, --verbose` | 详细日志 |

### 其他子命令

```bash
# 配置管理
dsca config list
dsca config set llm.defaultModel deepseek-chat

# 会话历史
dsca history list
dsca history clear

# 工具管理
dsca tool list                 # 列出所有工具(内置 + 自定义 + MCP)
dsca tool installed            # 已安装的技能包
dsca tool install <pkg>        # 从 npm 或本地路径安装技能
dsca tool uninstall <name>     # 卸载技能
dsca tool create <name>        # 脚手架生成新技能项目
```

## 内置工具(18 个)

| 工具 | 危险级别 | 说明 |
| --- | --- | --- |
| `read_file` | low | 读取文件内容,可指定行范围 |
| `edit_file` | medium | 对文件做定向文本替换 |
| `write_file` | medium | 写入/覆盖整个文件 |
| `create_file` | medium | 新建文件(已存在则失败) |
| `delete_file` | high | 删除文件(移入 `.trash`,可恢复) |
| `list_dir` | low | 递归列出目录内容 |
| `search_code` | low | 跨工作区搜索文本/正则 |
| `run_command` | high | 执行 shell 命令 |
| `run_tests` | medium | 运行项目测试套件(自动识别框架) |
| `process_manager` | medium | 进程管理(按端口/名称查找等) |
| `git_command` | medium | 执行 git 命令 |
| `http_request` | high | 发送 HTTP 请求 |
| `inspect_env` | low | 检查运行环境(代理/VPN 等) |
| `web_search` | low | 联网搜索文档/报错/API 参考 |
| `fetch_url` | low | 抓取 URL 并提取正文 |
| `diff_files` | low | 比较两个文件差异 |
| `batch_replace` | high | 跨多文件批量替换 |
| `tool_search` | low | 按关键词搜索可用工具 |

## SDK 用法

`@dsca/sdk` 提供编程式接口,可在自己的 Node 程序中驱动 Agent:

```ts
import { CodeAgent } from '@dsca/sdk';

const agent = new CodeAgent({
  llmConfig: {
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  workspacePath: process.cwd(),
  confirmAll: true,
});

const session = await agent.run('给 divide() 加除零检查', 'plan', {
  onLog: (m) => console.log(m),
  onStepChange: (step) => console.log(`#${step.id} ${step.status}`),
  // plan 模式交互回调
  onInteractiveChoice: async (prompt, choices) => 1, // 1=批准执行全部
  onInteractiveInput: async (prompt) => '附加需求…',   // 选择"修改计划"时被调用
  onToolCall: async (name) => true,
});

console.log(session.status, session.tokenUsage);
await agent.dispose();
```

## 开发

```bash
npm run dev     # turbo watch 模式
npm run build   # 构建全部包
npm test        # 运行 vitest 测试
npm run clean   # 清理产物与 node_modules
```

`test_project/` 目录下提供了多个不同语言/复杂度的测试项目,可用于验证 Agent 行为:

```bash
# 建议先复制一份副本再测试,避免改动原始文件
cp -r test_project/python_basic /tmp/demo
dsca plan "给 divide() 加除零检查抛 ValueError" -w /tmp/demo
```

## License

ISC
