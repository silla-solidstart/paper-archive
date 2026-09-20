import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Env } from "./types.ts";

/**
 * The LLM answers "what does this document mean?" — never "what text is on it".
 * It receives the Document AI OCR text and the original image together: OCR
 * gives canonical characters, the image gives layout the text stream loses.
 */

// Closed sets. Free text here means tax_notice / tax-notice / 税金 all appear
// over time and the Inbox cannot group them. Extend the list; never free it.
export const DOCUMENT_TYPES = [
  "tax_notice",
  "government_notice",
  "utility_bill",
  "insurance",
  "bank_statement",
  "invoice",
  "receipt",
  "school_letter",
  "medical",
  "contract",
  "subscription",
  "advertisement",
  "other",
] as const;

export const CATEGORIES = [
  "tax",
  "property",
  "utilities",
  "insurance",
  "finance",
  "education",
  "health",
  "legal",
  "employment",
  "housing",
  "vehicle",
  "government",
  "shopping",
  "other",
] as const;

export const RETENTION_STATUSES = [
  "digital_sufficient",
  "keep_temporarily",
  "keep_original",
  "unsure",
] as const;
export type RetentionStatus = (typeof RETENTION_STATUSES)[number];

// Handling: what the product DOES with a document. A set, because a utility
// bill is an expense and, until paid, a to-do. Everything routes off this.
export const HANDLING = ["todo", "expense", "record", "notice", "noise"] as const;
export type Handling = (typeof HANDLING)[number];

// Expense taxonomy. Fixed codes: "how much on snacks in August" is a SQL
// question over these, never a text search, so language never enters it.
export const EXPENSE_KINDS = [
  "groceries", "dining", "transport", "utilities", "housing", "medical", "education", "clothing",
  "household", "electronics", "entertainment", "subscription", "insurance", "tax", "business", "other",
] as const;
export const ITEM_CATEGORIES = [
  "groceries", "snacks", "alcohol", "beverages", "household", "dining", "transport", "utilities", "medical",
  "education", "clothing", "electronics", "entertainment", "subscription", "fees", "tax", "business", "other",
] as const;
export const PAYMENT_METHODS = ["cash", "card", "transfer", "direct_debit", "e_money", "other"] as const;

/**
 * Bumped whenever the schema or the prompt changes in a way worth re-running
 * old documents for. documents.extraction_version records what produced a
 * row; anything below this is "stale" and re-analysable in bulk.
 */
export const EXTRACTION_VERSION = 2;

// The nested expense lists are plain strings, not enums: every enum inside an
// array multiplies the constrained-decoding grammar, and with ~18 categories
// per line item the API refuses the request ("compiled grammar is too
// large"). normaliseExpense() snaps unknown values to "other" instead.
export const ExpenseItemSchema = z.object({
  name: z.string().describe("Line item as printed, original language"),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable().describe("Line total as printed"),
  category: z.string().describe(`One of: ${ITEM_CATEGORIES.join(", ")}`),
});
export const ExpenseSchema = z.object({
  merchant: z.string().nullable().describe("Payee as printed"),
  merchant_key: z.string().nullable().describe("Short stable name of the payee, original language, no legal suffixes (株式会社, Co., Ltd.)"),
  spent_on: z.string().nullable().describe("Date of the expense, ISO YYYY-MM-DD"),
  total: z.number().nullable().describe("Grand total actually paid or payable"),
  tax: z.number().nullable().describe("Consumption tax / VAT included in total, if printed"),
  currency: z.string().describe("ISO 4217, JPY unless printed otherwise"),
  payment_method: z.string().nullable().describe(`One of: ${PAYMENT_METHODS.join(", ")}; null if not printed`),
  expense_kind: z.string().describe(`Kind of the expense as a whole. One of: ${EXPENSE_KINDS.join(", ")}`),
  items: z
    .array(ExpenseItemSchema)
    .describe("Line items, best effort, in printed order. Empty when the document has a single amount. Skip subtotal/tax/total lines."),
});
// Rows are pipe-joined strings, not string[][]: a second level of arrays next
// to the expense items is what tips the grammar over the API's size limit.
// Split back into cells after parse (see splitTables).
export const TableSchema = z.object({
  title: z.string().nullable().describe("Caption or nearby heading, as printed"),
  header: z.string().describe("Header cells as printed, separated by ' | '"),
  rows: z.array(z.string()).describe("One string per body row, cells as printed separated by ' | ', same count as the header"),
});
export interface Table { title: string | null; columns: string[]; rows: string[][] }
const cells = (line: string) => line.split(" | ").map((c) => c.trim());
export function splitTables(raw: Array<z.infer<typeof TableSchema>>): Table[] {
  return raw.slice(0, 4).map((t) => ({ title: t.title, columns: cells(t.header), rows: t.rows.slice(0, 40).map(cells) }));
}

export const CoreSchema = z.object({
  title: z.string().describe("Document title as printed, in its original language"),
  document_type: z.enum(DOCUMENT_TYPES).describe("Closest type; use other if none fits"),
  issuer: z.string().nullable().describe("Issuing organisation as printed"),
  document_date: z
    .string()
    .nullable()
    .describe("Issue date as ISO YYYY-MM-DD. Convert 和暦 (令和/平成) to Gregorian."),
  summary: z.string().describe("One sentence, plain language, in English"),

  action_required: z.boolean(),
  action_type: z
    .string()
    .nullable()
    .describe("payment, appointment, renewal, signature, response, cancellation, or null"),
  action_date: z.string().nullable().describe("Deadline as ISO YYYY-MM-DD"),

  retention: z.enum(RETENTION_STATUSES),
  retention_reason: z.string().describe("Why, in one sentence"),

  categories: z.array(z.enum(CATEGORIES)),

  // Common structured fields, promoted because they are queried across types.
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  due_date: z.string().nullable().describe("ISO YYYY-MM-DD if distinct from action_date"),
  reference_number: z.string().nullable(),

  // Everything type-specific. Kept as pairs rather than a free-form object so
  // the schema stays strict.
  other_fields: z.array(z.object({ key: z.string(), value: z.string() })),

  // v2 — labelling and structure. See migrations/0006_enrich.sql.
  source_lang: z.enum(["ja", "en", "other"]).describe("Language the document is printed in"),
  handling: z
    .array(z.enum(HANDLING))
    .describe("What to do with it. todo = has an action; expense = money left the household/business; record = keep for reference; notice = informational; noise = advertising or junk. Usually one or two values."),
  issuer_key: z
    .string()
    .nullable()
    .describe("Short stable name of the issuer in its own language, without legal suffixes or department names: 東京電力, 上越市, ヨドバシカメラ, Tokyo Gas"),
  // No maxItems here: bounded arrays unroll in the constrained-decoding
  // grammar and push the request over the API's size limit. Truncated after parse.
  keywords: z
    .array(z.string())
    .describe("Up to 10 terms someone might search for, in BOTH Japanese and English where sensible (固定資産税, property tax, 上越市, Joetsu). No sentences."),
  has_tables: z.boolean().describe("True when the document contains tabular content worth keeping as data (usage history, statements, schedules)"),
});

/**
 * The second call. Expense lines and tables cannot share one structured
 * output with the core schema: together they exceed the API's grammar size
 * limit ("compiled grammar is too large"), and nesting them any further
 * makes it worse. So the core call decides whether they exist, and this call
 * runs only for expense documents and documents with tables.
 */
export const DetailSchema = z.object({
  tables: z
    .array(TableSchema)
    .describe("Tabular content worth keeping as data. Best effort; at most 4 tables, at most 40 rows each. Empty when there is none."),
  expense: ExpenseSchema.nullable().describe("Present when the document is an expense (receipt, bill, invoice, tax payment); null otherwise"),
});

/** The combined shape, as the rest of the app sees it. */
export const ExtractionSchema = CoreSchema.omit({ has_tables: true }).extend(DetailSchema.shape);

export type Extraction = Omit<z.infer<typeof ExtractionSchema>, "tables"> & { tables: Table[] };
export type Expense = z.infer<typeof ExpenseSchema>;
export type ExpenseItem = z.infer<typeof ExpenseItemSchema>;

const snap = <T extends readonly string[]>(list: T, v: string | null | undefined, fallback: T[number] | null): T[number] | null => {
  const k = (v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (list as readonly string[]).includes(k) ? (k as T[number]) : fallback;
};

/** Snaps the free-text expense codes onto the fixed lists (unknown → other / null). */
export function normaliseExpense(e: Expense | null): Expense | null {
  if (!e) return null;
  return {
    ...e,
    expense_kind: snap(EXPENSE_KINDS, e.expense_kind, "other")!,
    payment_method: snap(PAYMENT_METHODS, e.payment_method, null),
    currency: (e.currency || "JPY").toUpperCase().slice(0, 3),
    items: e.items.map((it) => ({ ...it, category: snap(ITEM_CATEGORIES, it.category, "other")! })),
  };
}

export type Lang = "en" | "ja";

export interface ExtractResult {
  extraction: Extraction;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  model: string;
}

export const EXTRACTION_MODEL = "claude-opus-5";

const SYSTEM = `You read scanned personal paperwork and return structured metadata.

Most documents are Japanese: municipal notices, utility bills, tax documents,
school letters, receipts, contracts. Some are English.

Rules:
- The OCR text is canonical for characters. The image is canonical for layout.
  Where they disagree about a character, trust the OCR text.
- Convert 和暦 era dates to Gregorian ISO dates. 令和N年 = 2018+N.
  令和8年9月30日 is 2026-09-30. Never guess a year you cannot derive.
- Use null rather than inventing a value. A missing field is a correct answer.
- Keep title and issuer in the original language exactly as printed.
- Write summary and retention_reason in the USER'S language, given below. They
  are shown to the user; plain, one sentence each.
- action_type and document_type are machine values from the fixed lists; do
  not translate them.

Retention — be conservative. This decides whether someone throws away an original:
- keep_original: has legal, tax, or ownership significance, or is required in
  original form (contracts, deeds, certificates, official seals/印鑑証明).
- keep_temporarily: needed until an action completes or a period lapses
  (an unpaid bill, a warranty still running).
- digital_sufficient: informational only, reissuable, no legal weight
  (advertising, notifications, statements that are also available online).
- unsure: anything you cannot confidently place above.

Receipts (領収書) and invoices (請求書) are never digital_sufficient. The user
may be a business or sole proprietor, and under 電子帳簿保存法 a casual scan is
not a compliant substitute for the original. Answer keep_temporarily if the
document is clearly personal and small; otherwise unsure.

Never answer digital_sufficient to be helpful. "unsure" is the correct answer
when you are unsure, and the product surfaces it for human review.
Handling — pick every value that applies:
- todo: something must be done (pay, sign, reply, attend, renew). Implies action_required.
- expense: money left, or will leave, the household or business: receipts,
  paid or payable invoices, utility and phone bills, tax payments, tuition,
  subscriptions. Fill in "expense" for these, itemising receipts line by line
  where the lines are legible. A missing line total is null, never invented.
- record: worth keeping as reference (contracts, certificates, statements,
  insurance policies, school schedules).
- notice: informational only, nothing to do, no money.
- noise: advertising, flyers, junk. Nothing else applies.
Expense item categories: snacks means confectionery, chips, sweets; groceries
means food and drink ingredients; beverages means non-alcoholic drinks bought
as drinks; alcohol as such; household means consumables, cleaning, toiletries.
Keep item names exactly as printed, abbreviations included.
Tables: reproduce cells as printed; do not compute or normalise values.
If the user says who the document is from, trust that for issuer_key and use it
to resolve an ambiguous or partially legible issuer, but keep issuer as printed.`;

const DETAIL_SYSTEM = `You read scanned personal paperwork and return its structured content.
The OCR text is canonical for characters; the image is canonical for layout.
Expense: fill it in when money left, or will leave, the household or business
(receipts, paid or payable invoices, utility and phone bills, tax payments,
tuition, subscriptions). Itemise receipts line by line where legible, in
printed order; skip subtotal, tax and total lines. Keep item names exactly as
printed, abbreviations included. A missing line total is null, never invented.
Item categories: snacks = confectionery, chips, sweets; groceries = food and
drink ingredients; beverages = non-alcoholic drinks bought as drinks; alcohol
as such; household = consumables, cleaning, toiletries.
Tables: reproduce cells as printed, ' | ' between cells; do not compute or
normalise values. Empty when there is none. Dates ISO, 和暦 converted.`;

const USER_LANGUAGE: Record<Lang, string> = {
  en: "The user's language is English. Write summary and retention_reason in English.",
  ja: "ユーザーの言語は日本語です。summary と retention_reason は自然な日本語で書いてください。",
};

export async function extract(
  env: Env,
  ocrText: string,
  image: { data: string; mediaType: string } | null,
  lang: Lang = "en",
  hint: { from?: string | null } = {},
): Promise<ExtractResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const content: Anthropic.ContentBlockParam[] = [];
  if (image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType as "image/png" | "image/jpeg" | "image/webp",
        data: image.data,
      },
    });
  }
  const from = hint.from?.trim().slice(0, 120);
  content.push({
    type: "text",
    text:
      `Document AI OCR output:\n\n<ocr>\n${ocrText}\n</ocr>\n\n` +
      (from ? `The user says this document is from: <from>${from}</from>\n\n` : "") +
      `Extract the metadata.`,
  });

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const call = async <T extends z.ZodTypeAny>(system: string, schema: T, what: string): Promise<z.infer<T>> => {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`${what} refused: ${response.stop_details?.category ?? "unknown"}`);
    }
    if (!response.parsed_output) throw new Error(`${what} returned no parsed output`);
    const u = response.usage;
    usage.inputTokens += u.input_tokens;
    usage.outputTokens += u.output_tokens;
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    return response.parsed_output as z.infer<T>;
  };

  // The stable rules first, the per-request language last, so the long
  // prefix stays cacheable across users.
  const { has_tables, ...core } = await call(`${SYSTEM}\n\n${USER_LANGUAGE[lang]}`, CoreSchema, "Extraction");
  let detail: z.infer<typeof DetailSchema> = { tables: [], expense: null };
  if (core.handling.includes("expense") || has_tables) {
    detail = await call(DETAIL_SYSTEM, DetailSchema, "Detail extraction");
  }
  return {
    extraction: {
      ...core,
      keywords: core.keywords.slice(0, 10),
      tables: splitTables(detail.tables),
      expense: core.handling.includes("expense") ? normaliseExpense(detail.expense) : null,
    },
    usage,
    model: EXTRACTION_MODEL,
  };
}
