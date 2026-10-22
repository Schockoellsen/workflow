// Werkstatt-Freigabe (MCP-Server über stdio) | workshop-prototype/approval-mcp.mjs
// Claude Code ruft dieses Werkzeug auf, bevor es etwas tun will, das nicht von selbst erlaubt ist
// (z. B. Roblox Studio ändern oder Play starten). Die Anfrage geht an den Werkstatt-Server, Timo
// klickt dort „Erlauben“ oder „Ablehnen“, und die Antwort geht zurück an Claude.
// Ohne Antwort innerhalb der Wartezeit gilt: abgelehnt.

import { createInterface } from 'node:readline';

const SERVER = process.env.IE_WORKSHOP_URL || 'http://127.0.0.1:4173';
const TOKEN = process.env.IE_APPROVAL_TOKEN || '';
const PROVIDER = process.env.IE_APPROVAL_PROVIDER || 'Claude';
const TOOL_NAME = 'freigabe';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function deny(text) {
  return { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: text }) }] };
}

async function askWorkshop(args) {
  const toolName = typeof args?.tool_name === 'string' ? args.tool_name : 'unbekannt';
  const input = args && typeof args.input === 'object' && args.input !== null ? args.input : {};
  if (!TOKEN) return deny('Die Werkstatt-Freigabe ist nicht eingerichtet (kein Token).');
  let response;
  try {
    response = await fetch(`${SERVER}/api/approvals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Approval-Token': TOKEN },
      body: JSON.stringify({ provider: PROVIDER, toolName, input })
    });
  } catch (error) {
    return deny(`Die Werkstatt ist nicht erreichbar: ${error.message}`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return deny(result.error || 'Die Werkstatt hat die Anfrage abgelehnt.');
  if (result.decision === 'allow') {
    return { content: [{ type: 'text', text: JSON.stringify({ behavior: 'allow', updatedInput: input }) }] };
  }
  return deny(result.reason || 'Timo hat diese Aktion in der Werkstatt abgelehnt.');
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'werkstatt_freigabe', version: '1.0.0' }
      }
    });
  }
  if (method === 'notifications/initialized' || id === undefined) return undefined;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: TOOL_NAME,
          description: 'Fragt Timo in der IE Werkstatt, ob eine Aktion erlaubt ist. Wird von Claude Code automatisch benutzt.',
          inputSchema: {
            type: 'object',
            properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
            required: ['tool_name', 'input']
          }
        }]
      }
    });
  }
  if (method === 'tools/call') {
    if (params?.name !== TOOL_NAME) {
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unbekanntes Werkzeug.' } });
    }
    return send({ jsonrpc: '2.0', id, result: await askWorkshop(params.arguments) });
  }
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Methode nicht unterstützt: ${method}` } });
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  handle(message).catch((error) => {
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
  });
});
