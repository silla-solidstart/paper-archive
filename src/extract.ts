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
});

export type Extraction = z.infer<typeof ExtractionSchema>;

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
when you are unsure, and the product surfaces it for human review.`;

const USER_LANGUAGE: Record<Lang, string> = {
  en: "The user's language is English. Write summary and retention_reason in English.",
  ja: "ユーザーの言語は日本語です。summary と retention_reason は自然な日本語で書いてください。",
};

export async function extract(
  env: Env,
  ocrText: string,
  image: { data: string; mediaType: string } | null,
  lang: Lang = "en",
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
  content.push({
    type: "text",
    text: `Document AI OCR output:\n\n<ocr>\n${ocrText}\n</ocr>\n\nExtract the metadata.`,
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
