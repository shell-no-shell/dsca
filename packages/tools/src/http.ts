import axios from 'axios';
import { URL } from 'url';
import { ITool, ToolContext, ToolResult } from './registry.js';

export const httpRequestTool: ITool = {
  name: 'http_request',
  description: 'Send HTTP requests (GET, POST, etc.) to fetch external docs or APIs.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The absolute target URL' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (defaults to GET)' },
      headers: { type: 'object', description: 'Optional request headers' },
      data: { type: 'object', description: 'Optional request body data' }
    },
    required: ['url']
  },
  dangerLevel: 'high',
  async execute(args: { url: string; method?: string; headers?: any; data?: any }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const parsedUrl = new URL(args.url);
      const host = parsedUrl.hostname;

      if (ctx.allowedDomains && ctx.allowedDomains.length > 0) {
        const isAllowed = ctx.allowedDomains.some(domain => {
          // exact match or wildcard subdomain
          if (domain.startsWith('*.')) {
            const rootDomain = domain.slice(2);
            return host === rootDomain || host.endsWith('.' + rootDomain);
          }
          return host === domain;
        });
        
        if (!isAllowed) {
          return {
            success: false,
            output: `Access denied: host '${host}' is not in the allowed domains list [${ctx.allowedDomains.join(', ')}]`
          };
        }
      }

      const method = (args.method || 'GET').toUpperCase();
      const response = await axios({
        url: args.url,
        method,
        headers: args.headers,
        data: args.data,
        timeout: 10000 // 10s timeout
      });

      const responseData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
      return {
        success: true,
        output: responseData,
        data: {
          status: response.status,
          headers: response.headers
        }
      };
    } catch (e: any) {
      const errorMsg = e.response
        ? `HTTP Error ${e.response.status}: ${JSON.stringify(e.response.data)}`
        : e.message;
      return { success: false, output: `Request failed: ${errorMsg}` };
    }
  }
};
