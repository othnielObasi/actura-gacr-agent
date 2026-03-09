
/**
 * Actura MCP Server
 * Lightweight MCP-compatible HTTP + JSON-RPC server for discovery, tools,
 * resources, and prompts. Designed for hackathon demos and local integration.
 */

import express from 'express';
import type { Server } from 'http';
import { execSync } from 'child_process';
import { ALL_TOOLS, type McpTool } from './tools.js';
import { ALL_RESOURCES, type McpResource } from './resources.js';
import { ALL_PROMPTS, type McpPrompt } from './prompts.js';
import { config } from '../agent/config.js';

const MCP_PORT = 3001;

let mcpHttpServer: Server | null = null;

export function stopMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (mcpHttpServer) {
      mcpHttpServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

async function callTool(tool: McpTool, args: Record<string, unknown>) {
  return tool.handler(args);
}

async function readResource(resource: McpResource, params: Record<string, unknown>) {
  return resource.handler(params);
}

async function getPrompt(prompt: McpPrompt, args: Record<string, unknown>) {
  return prompt.handler(args);
}

/**
 * Start the MCP server
 */
export function startMcpServer(port: number = MCP_PORT): void {
  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Actura-Role');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'actura-mcp',
      endpoint: config.mcpEndpoint,
      tools: ALL_TOOLS.length,
      resources: ALL_RESOURCES.length,
      prompts: ALL_PROMPTS.length,
      version: '2.0.0',
    });
  });

  app.get('/mcp/info', (_req, res) => {
    res.json({
      name: 'Actura MCP',
      description: 'Governed MCP interface for trust, governance, performance, and operator workflows',
      endpoint: config.mcpEndpoint,
      supports: ['tools', 'resources', 'prompts', 'json-rpc'],
      tools: ALL_TOOLS.map(({ name, description, visibility, category }) => ({ name, description, visibility, category })),
      resources: ALL_RESOURCES.map(({ uri, name, description, visibility }) => ({ uri, name, description, visibility })),
      prompts: ALL_PROMPTS.map(({ name, description, visibility }) => ({ name, description, visibility })),
    });
  });

  app.get('/mcp/tools', (_req, res) => {
    res.json({
      tools: ALL_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        visibility: t.visibility,
        inputSchema: t.inputSchema,
      })),
    });
  });

  app.get('/mcp/resources', (_req, res) => {
    res.json({
      resources: ALL_RESOURCES.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        visibility: r.visibility,
        mimeType: r.mimeType,
      })),
    });
  });

  app.get('/mcp/prompts', (_req, res) => {
    res.json({
      prompts: ALL_PROMPTS.map(p => ({
        name: p.name,
        description: p.description,
        visibility: p.visibility,
        arguments: p.arguments,
      })),
    });
  });

  app.post('/mcp/tools/:toolName', async (req, res) => {
    const tool = ALL_TOOLS.find(t => t.name === req.params.toolName);
    if (!tool) {
      res.status(404).json({ error: `Tool not found: ${req.params.toolName}` });
      return;
    }

    try {
      const result = await callTool(tool, req.body || {});
      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/mcp/resources/:resourceUri', async (req, res) => {
    const uri = `actura://${req.params.resourceUri}`;
    const resource = ALL_RESOURCES.find(r => r.uri === uri);
    if (!resource) {
      res.status(404).json({ error: `Resource not found: ${uri}` });
      return;
    }

    try {
      const data = await readResource(resource, req.query as Record<string, unknown>);
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/mcp/prompts/:promptName', async (req, res) => {
    const prompt = ALL_PROMPTS.find(p => p.name === req.params.promptName);
    if (!prompt) {
      res.status(404).json({ error: `Prompt not found: ${req.params.promptName}` });
      return;
    }

    try {
      const data = await getPrompt(prompt, req.body || {});
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /mcp — browser-friendly landing page for the JSON-RPC endpoint
  app.get('/mcp', (_req, res) => {
    res.json({
      name: 'Actura MCP',
      description: 'Governed MCP interface — JSON-RPC endpoint (use POST)',
      version: '2.0.0',
      endpoint: config.mcpEndpoint,
      protocol: 'JSON-RPC 2.0 over HTTP POST',
      discovery: {
        health: '/health',
        info: '/mcp/info',
        tools: '/mcp/tools',
        resources: '/mcp/resources',
        prompts: '/mcp/prompts',
      },
      tools: ALL_TOOLS.length,
      resources: ALL_RESOURCES.length,
      prompts: ALL_PROMPTS.length,
      usage: {
        example: 'POST /mcp with { "jsonrpc": "2.0", "method": "tools/list", "id": 1 }',
        methods: ['tools/list', 'tools/call', 'resources/list', 'resources/read', 'prompts/list', 'prompts/get'],
      },
    });
  });

  app.post('/mcp', async (req, res) => {
    const { method, params, id } = req.body || {};
    const args = params?.arguments || params || {};

    try {
      switch (method) {
        case 'tools/list':
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              tools: ALL_TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                category: t.category,
                visibility: t.visibility,
                inputSchema: t.inputSchema,
              })),
            },
          });
          return;

        case 'tools/call': {
          const tool = ALL_TOOLS.find(t => t.name === params?.name);
          if (!tool) {
            res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${params?.name}` } });
            return;
          }
          const result = await callTool(tool, args);
          res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          });
          return;
        }

        case 'resources/list':
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              resources: ALL_RESOURCES.map(r => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                visibility: r.visibility,
                mimeType: r.mimeType,
              })),
            },
          });
          return;

        case 'resources/read': {
          const resource = ALL_RESOURCES.find(r => r.uri === params?.uri);
          if (!resource) {
            res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Resource not found: ${params?.uri}` } });
            return;
          }
          const data = await readResource(resource, args);
          res.json({
            jsonrpc: '2.0',
            id,
            result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(data, null, 2) }] },
          });
          return;
        }

        case 'prompts/list':
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              prompts: ALL_PROMPTS.map(p => ({
                name: p.name,
                description: p.description,
                visibility: p.visibility,
                arguments: p.arguments,
              })),
            },
          });
          return;

        case 'prompts/get': {
          const prompt = ALL_PROMPTS.find(p => p.name === params?.name);
          if (!prompt) {
            res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Prompt not found: ${params?.name}` } });
            return;
          }
          const promptResult = await getPrompt(prompt, args);
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              description: prompt.description,
              messages: [{ role: 'user', content: { type: 'text', text: promptResult.text } }],
            },
          });
          return;
        }

        default:
          res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
          return;
      }
    } catch (error) {
      res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error) } });
    }
  });

  // Kill any orphan process holding the port before binding
  try { execSync(`fuser -k ${port}/tcp 2>/dev/null`, { timeout: 3000 }); } catch {}
  
  const tryListen = (retries = 3) => {
    mcpHttpServer = app.listen(port, () => {
      console.log(`[MCP] Actura MCP server listening on http://localhost:${port}`);
      console.log(`[MCP] JSON-RPC endpoint: http://localhost:${port}/mcp`);
      console.log(`[MCP] ${ALL_TOOLS.length} tools, ${ALL_RESOURCES.length} resources, ${ALL_PROMPTS.length} prompts`);
    });
    mcpHttpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retries > 0) {
        console.log(`[MCP] Port ${port} in use, retrying in 3s...`);
        try { execSync(`fuser -k ${port}/tcp 2>/dev/null`, { timeout: 3000 }); } catch {}
        setTimeout(() => tryListen(retries - 1), 3000);
      } else {
        console.error(`[MCP] Failed to start: ${err.message}`);
      }
    });
  };
  tryListen();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
