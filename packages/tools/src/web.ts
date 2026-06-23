import axios from 'axios';
import { execSync } from 'child_process';
import { ITool, ToolContext, ToolResult } from './registry.js';

/**
 * Web search tool — searches the web using DuckDuckGo Lite (no API key required).
 * Falls back to Google search via curl if DuckDuckGo is unavailable.
 */
export const webSearchTool: ITool = {
  name: 'web_search',
  description: 'Search the web for documentation, error messages, API references, library usage, etc. Returns a list of relevant results with titles, URLs, and snippets. Useful when you need to look up how an API works, find solutions to error messages, or research a library.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query string' },
      maxResults: { type: 'number', description: 'Maximum number of results to return (default: 5, max: 10)' },
    },
    required: ['query'],
  },
  dangerLevel: 'low',
  async execute(args: { query: string; maxResults?: number }, ctx: ToolContext): Promise<ToolResult> {
    const maxResults = Math.min(args.maxResults || 5, 10);

    // Strategy 1: DuckDuckGo Lite HTML scraping (no API key needed)
    try {
      const resp = await axios.get('https://lite.duckduckgo.com/lite/', {
        params: { q: args.query },
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      const html = resp.data as string;
      const results = parseDuckDuckGoLite(html, maxResults);

      if (results.length > 0) {
        const output = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join('\n\n');
        return { success: true, output, data: { results, source: 'duckduckgo' } };
      }
    } catch {}

    // Strategy 2: DuckDuckGo API (instant answers)
    try {
      const resp = await axios.get('https://api.duckduckgo.com/', {
        params: { q: args.query, format: 'json', no_redirect: 1 },
        timeout: 8000,
      });

      const data = resp.data;
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      // Abstract (main answer)
      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading || 'Result',
          url: data.AbstractURL,
          snippet: data.AbstractText.slice(0, 200),
        });
      }

      // Related topics
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.FirstURL && topic.Text) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
              url: topic.FirstURL,
              snippet: topic.Text.slice(0, 200),
            });
          }
        }
      }

      if (results.length > 0) {
        const output = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join('\n\n');
        return { success: true, output, data: { results, source: 'duckduckgo-api' } };
      }
    } catch {}

    // Strategy 3: curl-based fallback (search via Google and parse snippets)
    try {
      const encoded = encodeURIComponent(args.query);
      const html = execSync(
        `curl -sS -L --max-time 10 "https://www.google.com/search?q=${encoded}&num=${maxResults}" ` +
        `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" 2>/dev/null`,
        { stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 }
      ).toString();

      const results = parseGoogleHTML(html, maxResults);
      if (results.length > 0) {
        const output = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join('\n\n');
        return { success: true, output, data: { results, source: 'google' } };
      }
    } catch {}

    return {
      success: false,
      output: `No search results found for: "${args.query}". Web search may be unavailable due to network restrictions.`,
    };
  },
};


/**
 * Fetch and extract readable text content from a URL.
 * Unlike http_request (which returns raw response), this tool extracts
 * the main text content, strips HTML, and truncates for readability.
 */
export const fetchUrlTool: ITool = {
  name: 'fetch_url',
  description: 'Fetch a URL and extract its readable text content. Strips HTML tags and returns clean text. Useful for reading documentation pages, API references, README files, blog posts, etc. For raw API responses, use http_request instead.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      maxLength: { type: 'number', description: 'Maximum length of extracted text (default: 4000 chars)' },
      selector: { type: 'string', description: 'Optional: CSS-like content hint — "article", "main", "readme", "code". Helps focus extraction on the relevant section.' },
    },
    required: ['url'],
  },
  dangerLevel: 'low',
  async execute(args: { url: string; maxLength?: number; selector?: string }, ctx: ToolContext): Promise<ToolResult> {
    const maxLength = args.maxLength || 4000;

    try {
      const resp = await axios.get(args.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        maxRedirects: 5,
        // Handle different content types
        responseType: 'text',
      });

      const contentType = String(resp.headers['content-type'] || '');
      let text: string;

      if (contentType.includes('application/json')) {
        // JSON response — pretty print
        const json = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        text = JSON.stringify(json, null, 2);
      } else if (contentType.includes('text/plain') || contentType.includes('text/')) {
        // Plain text / markdown — return as-is
        text = resp.data;
      } else {
        // HTML — extract readable text
        text = extractReadableText(resp.data, args.selector);
      }

      // Truncate
      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + '\n\n... (truncated, ' + text.length + ' total chars)';
      }

      return {
        success: true,
        output: text,
        data: {
          url: args.url,
          contentType,
          length: text.length,
        },
      };
    } catch (e: any) {
      const errorMsg = e.response
        ? `HTTP ${e.response.status}: ${e.response.statusText}`
        : e.message;
      return { success: false, output: `Failed to fetch ${args.url}: ${errorMsg}` };
    }
  },
};


// ─── Helper functions ───

function parseDuckDuckGoLite(html: string, maxResults: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // DuckDuckGo Lite uses simple table rows for results
  // Each result has: link with class "result-link" and snippet text
  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({ url: match[1], title: stripHtml(match[2]).trim() });
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title || 'Untitled',
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

function parseGoogleHTML(html: string, maxResults: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Google wraps results in <a> tags with /url?q= prefix
  const blockRegex = /<a[^>]*href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const url = decodeURIComponent(match[1]);
    const title = stripHtml(match[2]).trim();

    // Skip internal Google links
    if (url.startsWith('http') && !url.includes('google.com') && title.length > 5) {
      results.push({ url, title, snippet: '' });
    }
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReadableText(html: string, hint?: string): string {
  // Remove script/style/nav/header/footer blocks
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Try to extract main content area based on hint
  if (hint) {
    const tagRegex = new RegExp(`<${hint}[^>]*>([\\s\\S]*?)<\\/${hint}>`, 'i');
    const tagMatch = cleaned.match(tagRegex);
    if (tagMatch) {
      cleaned = tagMatch[1];
    }

    // Also try common content selectors
    const contentPatterns = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*readme[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];
    for (const pattern of contentPatterns) {
      const m = cleaned.match(pattern);
      if (m && m[1].length > 200) {
        cleaned = m[1];
        break;
      }
    }
  }

  // Convert block elements to newlines for readability
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<li[^>]*>/gi, '• ');

  // Strip remaining HTML tags
  const text = stripHtml(cleaned);

  // Collapse excessive whitespace while preserving paragraph breaks
  return text
    .split('\n')
    .map(line => line.trim())
    .filter((line, i, arr) => {
      // Remove consecutive empty lines (keep max 1)
      if (line === '' && i > 0 && arr[i - 1] === '') return false;
      return true;
    })
    .join('\n')
    .trim();
}
