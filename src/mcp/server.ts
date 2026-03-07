/**
 * MCP Server
 * Exposes Actura's tools and resources via HTTP
 * 
 * This is a lightweight JSON-RPC style server that follows
 * MCP conventions for tool calling and resource reading.
 * 
 * In production, use @modelcontextprotocol/sdk for full compliance.
 * This implementation covers the hackathon requirements.
 */

import express from 'express';
import { ALL_TOOLS, type McpTool } from './tools.js';
import { ALL_RESOURCES, type McpResource } from './resources.js';
import { config } from '../agent/config.js';

const MCP_PORT = 3001;

/**
 * Start the MCP server
 */
export function startMcpServer(port: number = MCP_PORT): void {
  const app = express();
  app.use(express.json());

  // CORS for development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // ── Discovery ──

  /** List available tools */
  app.get('/mcp/tools', (_req, res) => {
    res.json({
      tools: ALL_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  /** List available resources */
  app.get('/mcp/resources', (_req, res) => {
    res.json({
      resources: ALL_RESOURCES.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    });
  });

  // ── Tool Execution ──

  /** Call a tool */
  app.post('/mcp/tools/:toolName', (req, res) => {
    const tool = ALL_TOOLS.find(t => t.name === req.params.toolName);
    if (!tool) {
      res.status(404).json({ error: `Tool not found: ${req.params.toolName}` });
      return;
    }

    try {
      const result = tool.handler(req.body || {});
      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Resource Reading ──

  /** Read a resource */
  app.get('/mcp/resources/:resourceUri', (req, res) => {
    const uri = `actura://${req.params.resourceUri}`;
    const resource = ALL_RESOURCES.find(r => r.uri === uri);
    if (!resource) {
      res.status(404).json({ error: `Resource not found: ${uri}` });
      return;
    }

    try {
      const data = resource.handler();
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── JSON-RPC endpoint (MCP standard) ──

  app.post('/mcp', (req, res) => {
    const { method, params, id } = req.body;

    try {
      switch (method) {
        case 'tools/list': {
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              tools: ALL_TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          });
          break;
        }

        case 'tools/call': {
          const tool = ALL_TOOLS.find(t => t.name === params?.name);
          if (!tool) {
            res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${params?.name}` } });
            return;
          }
          const result = tool.handler(params?.arguments || {});
          res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          });
          break;
        }

        case 'resources/list': {
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              resources: ALL_RESOURCES.map(r => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
              })),
            },
          });
          break;
        }

        case 'resources/read': {
          const resource = ALL_RESOURCES.find(r => r.uri === params?.uri);
          if (!resource) {
            res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Resource not found: ${params?.uri}` } });
            return;
          }
          const data = resource.handler();
          res.json({
            jsonrpc: '2.0',
            id,
            result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(data) }] },
          });
          break;
        }

        default:
          res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
      }
    } catch (error) {
      res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error) } });
    }
  });

  // ── Server info ──
  app.get('/mcp/info', (_req, res) => {
    res.json({
      name: config.agentName,
      description: config.agentDescription,
      version: '1.0',
      protocol: 'MCP',
      tools: ALL_TOOLS.length,
      resources: ALL_RESOURCES.length,
    });
  });

  app.listen(port, () => {
    console.log(`[MCP] Server running on http://localhost:${port}/mcp`);
    console.log(`[MCP] Tools: ${ALL_TOOLS.map(t => t.name).join(', ')}`);
    console.log(`[MCP] Resources: ${ALL_RESOURCES.map(r => r.uri).join(', ')}`);
  });
}
