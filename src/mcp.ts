import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Env } from "./types.ts";
import { ensureLocalUser, getDocument, listActions, searchDocuments, updateDocumentRetention } from "./db.ts";
import { RETENTION_STATUSES } from "./extract.ts";

/**
 * MCP: the archive as a tool for Claude and other assistants.
 *
 * This is a third consumer of the Postgres index, alongside the PWA and
 * search. It does not re-interpret documents — extraction happened at ingest.
 * "Where's that property tax letter?" is a search over stored metadata, not a
 * fresh read of every scan.
 *
 * Stateless transport: each request builds a server and tears it down. Fine
 * at this scale, and it means no session state lives in a Worker isolate.
 */

const text = (body: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
});

function buildServer(env: Env, userId: string): McpServer {
  const server = new McpServer({ name: "paper-archive", version: "0.1.0" });

  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description:
        "Search the user's scanned paperwork by keyword. Matches OCR text, title, " +
        "issuer and summary. Works for Japanese and English. Returns metadata only; " +
        "use get_document for the full text.",
      inputSchema: {
        query: z.string().describe("Keyword or phrase, e.g. 固定資産税, Tokyo Gas, 上越市"),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => text(await searchDocuments(env, userId, query, limit ?? 20)),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description:
        "Full record for one document: OCR text, extracted fields, retention " +
        "decision and reason, and any required action.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const doc = await getDocument(env, userId, id);
      return doc ? text(doc) : text({ error: "not found" });
    },
  );

  server.registerTool(
    "list_actions",
    {
      title: "List required actions",
      description:
        "Documents that need something from the user — payments, forms, " +
        "appointments — ordered by deadline, soonest first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) => text(await listActions(env, userId, limit ?? 50)),
  );

  server.registerTool(
    "set_retention_decision",
    {
      title: "Set retention decision",
      description:
        "Record the user's decision about whether the physical original can be " +
        "discarded. Only call this when the user has explicitly decided — never " +
        "infer it. Values: digital_sufficient, keep_temporarily, keep_original, unsure.",
      inputSchema: {
        id: z.string().uuid(),
        retention: z.enum(RETENTION_STATUSES),
        reason: z.string().optional().describe("The user's stated reason, if any"),
      },
    },
    async ({ id, retention, reason }) => {
      const ok = await updateDocumentRetention(env, userId, id, retention, reason ?? "Decided by user via assistant");
      return text(ok ? { ok: true, id, retention } : { error: "not found" });
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const userId = await ensureLocalUser(env);
  const server = buildServer(env, userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
  }
}
