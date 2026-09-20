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

export const ExpenseItemSchema = z.object({
  name: z.string().describe("Line item as printed, original language"),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable().describe("Line total as printed"),
  category: z.enum(ITEM_CATEGORIES),
});
export const ExpenseSchema = z.object({
  merchant: z.string().nullable().describe("Payee as printed"),
  merchant_key: z.string().nullable().describe("Short stable name of the payee, original language, no legal suffixes (株式会社, Co., Ltd.)"),
  spent_on: z.string().nullable().describe("Date of the expense, ISO YYYY-MM-DD"),
  total: z.number().nullable().describe("Grand total actually paid or payable"),
  tax: z.number().nullable().describe("Consumption tax / VAT included in total, if printed"),
  currency: z.string().describe("ISO 4217, JPY unless printed otherwise"),
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  expense_kind: z.enum(EXPENSE_KINDS).describe("Kind of the expense as a whole"),
  items: z
    .array(ExpenseItemSchema)
    .describe("Line items, best effort, in printed order. Empty when the document has a single amount. Skip subtotal/tax/total lines."),
});
export const TableSchema = z.object({
  title: z.string().nullable().describe("Caption or nearby heading, as printed"),
  columns: z.array(z.string()).describe("Header cells as printed"),
  rows: z.array(z.array(z.string())).describe("Body cells as printed, one array per row, same length as columns"),
});

export const ExtractionSchema = z.object({
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
  keywords: z
    .array(z.string())
    .max(10)
    .describe("Up to 10 terms someone might search for, in BOTH Japanese and English where sensible (固定資産税, property tax, 上越市, Joetsu). No sentences."),
  tables: z
    .array(TableSchema)
    .max(4)
    .describe("Tabular content worth keeping as data (usage history, statements, schedules). Best effort; at most 4 tables, at most 40 rows each. Empty when there is none."),
  expense: ExpenseSchema.nullable().describe("Present when handling includes expense; null otherwise"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type ExpenseItem = z.infer<typeof ExpenseItemSchema>;

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

  const response = await client.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    // The stable rules first, the per-request language last, so the long
    // prefix stays cacheable across users.
    system: `${SYSTEM}\n\n${USER_LANGUAGE[lang]}`,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Extraction refused: ${response.stop_details?.category ?? "unknown"}`,
    );
  }
  if (!response.parsed_output) {
    throw new Error("Extraction returned no parsed output");
  }
  const u = response.usage;
  return {
    extraction: response.parsed_output,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
    model: EXTRACTION_MODEL,
  };
}
