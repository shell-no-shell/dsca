import { spawn, ChildProcess } from 'child_process';
import { ITool, ToolRegistry, ToolContext, ToolResult } from './registry.js';

/**
 * MCP (Model Context Protocol) adapter.
 *
 * Communicates with external tool servers over stdio using JSON-RPC 2.0
 * and registers their tools into the DSCA ToolRegistry.
 *
 * MCP server config (in ~/.dsca/config.yaml or dsca-tool.json):
 *   mcp:
 *     servers:
 *       - name: "filesystem"
 *         command: "npx"
 *         args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
 *       - name: "postgres"
 *         command: "npx"
 *         args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpAdapter {
  private process: ChildProcess | null = null;
  private serverName: string;
  private config: McpServerConfig;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private buffer = '';
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.serverName = config.name;
  }

  /**
   * Start the MCP server process, initialize it, and register its tools.
   */
  async connect(registry: ToolRegistry): Promise<string[]> {
    // Spawn the server process
    this.process = spawn(this.config.command, this.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    });

    // Handle stdout (JSON-RPC responses)
    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (logs, errors)
    this.process.stderr!.on('data', (_data: Buffer) => {
      // MCP servers may log to stderr; we can ignore or forward
    });

    this.process.on('exit', (_code) => {
      this.connected = false;
      // Reject any pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`MCP server '${this.serverName}' exited`));
      }
      this.pendingRequests.clear();
    });

    // Initialize the connection
    try {
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dsca', version: '2.0.0' },
      });

      // Send initialized notification
      this.sendNotification('notifications/initialized', {});
      this.connected = true;

      // Discover tools
      const toolsResult = await this.sendRequest('tools/list', {});
      const tools: McpToolDefinition[] = toolsResult.tools || [];
      const loaded: string[] = [];

      for (const mcpTool of tools) {
        const tool = this.wrapMcpTool(mcpTool);
        registry.registerNamespaced(`mcp_${this.serverName}`, tool);
        loaded.push(`mcp_${this.serverName}.${mcpTool.name}`);
      }

      return loaded;
    } catch (e: any) {
      this.disconnect();
      throw new Error(`Failed to initialize MCP server '${this.serverName}': ${e.message}`);
    }
  }

  /**
   * Disconnect from the MCP server.
   */
  disconnect(): void {
    this.connected = false;
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
  }

  /**
   * Wrap an MCP tool definition into an ITool that calls the MCP server.
   */
  private wrapMcpTool(mcpTool: McpToolDefinition): ITool {
    return {
      name: mcpTool.name,
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      parameters: {
        type: 'object',
        properties: mcpTool.inputSchema?.properties || {},
        ...(mcpTool.inputSchema?.required ? { required: mcpTool.inputSchema.required } : {}),
      },
      dangerLevel: 'medium', // MCP tools are external, default to medium
      source: 'mcp',
      namespace: `mcp_${this.serverName}`,
      execute: async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
        if (!this.connected) {
          return { success: false, output: `MCP server '${this.serverName}' is not connected` };
        }

        try {
          const result = await this.sendRequest('tools/call', {
            name: mcpTool.name,
            arguments: args,
          });

          // MCP tool results contain an array of content blocks
          const content = result.content || [];
          const output = content
            .map((block: any) => {
              if (block.type === 'text') return block.text;
              if (block.type === 'image') return `[Image: ${block.mimeType}]`;
              if (block.type === 'resource') return `[Resource: ${block.uri}]`;
              return JSON.stringify(block);
            })
            .join('\n');

          const isError = result.isError === true;
          return { success: !isError, output: output || '(No output)' };
        } catch (e: any) {
          return { success: false, output: `MCP call failed: ${e.message}` };
        }
      },
    };
  }

  // ─── JSON-RPC transport ───

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 30000);

      // Store timeout for cleanup
      const original = this.pendingRequests.get(id)!;
      this.pendingRequests.set(id, {
        resolve: (value) => { clearTimeout(timeoutId); original.resolve(value); },
        reject: (reason) => { clearTimeout(timeoutId); original.reject(reason); },
      });

      this.writeMessage(request);
    });
  }

  private sendNotification(method: string, params: any): void {
    this.writeMessage({ jsonrpc: '2.0', method, params });
  }

  private writeMessage(message: any): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('MCP server stdin not writable');
    }
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    this.process.stdin.write(header + json);
  }

  private processBuffer(): void {
    // Parse Content-Length header + JSON body
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Try parsing as raw JSON (some servers don't use headers)
        this.tryParseRawJson();
        break;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      this.handleMessage(body);
    }
  }

  private tryParseRawJson(): void {
    // Some MCP servers send newline-delimited JSON without headers
    const lines = this.buffer.split('\n');
    const remaining: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.jsonrpc === '2.0') {
          this.handleResponse(parsed);
        }
      } catch {
        remaining.push(line);
      }
    }

    this.buffer = remaining.join('\n');
  }

  private handleMessage(body: string): void {
    try {
      const message = JSON.parse(body);
      if (message.jsonrpc === '2.0') {
        this.handleResponse(message);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === undefined) return; // notification, ignore

    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`${response.error.message} (code: ${response.error.code})`));
    } else {
      pending.resolve(response.result);
    }
  }
}

/**
 * Connect to multiple MCP servers and register all their tools.
 */
export async function connectMcpServers(
  configs: McpServerConfig[],
  registry: ToolRegistry
): Promise<{ loaded: string[]; errors: Array<{ server: string; error: string }>; adapters: McpAdapter[] }> {
  const loaded: string[] = [];
  const errors: Array<{ server: string; error: string }> = [];
  const adapters: McpAdapter[] = [];

  for (const config of configs) {
    const adapter = new McpAdapter(config);
    try {
      const tools = await adapter.connect(registry);
      loaded.push(...tools);
      adapters.push(adapter);
    } catch (e: any) {
      errors.push({ server: config.name, error: e.message });
    }
  }

  return { loaded, errors, adapters };
}
