import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Env } from "./types";

/**
 * The LLM answers "what does this document mean?" — never "what text is on it".
 * It receives the Document AI OCR text and the original image together: OCR
 * gives canonical characters, the image gives layout the text stream loses.
 */

export const ExtractionSchema = z.object({
  title: z.string().describe("Document title as printed, in its original language"),
  document_type: z
    .string()
    .describe("Snake_case type, e.g. tax_notice, utility_bill, school_letter, contract"),
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

  retention: z.enum([
    "digital_sufficient",
    "keep_temporarily",
    "keep_original",
    "unsure",
  ]),
  retention_reason: z.string().describe("Why, in one sentence"),

  categories: z.array(z.string()),

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

const SYSTEM = `You read scanned personal paperwork and return structured metadata.

Most documents are Japanese: municipal notices, utility bills, tax documents,
school letters, receipts, contracts. Some are English.

Rules:
- The OCR text is canonical for characters. The image is canonical for layout.
  Where they disagree about a character, trust the OCR text.
- Convert 和暦 era dates to Gregorian ISO dates. 令和N年 = 2018+N.
  令和8年9月30日 is 2026-09-30. Never guess a year you cannot derive.
- Use null rather than inventing a value. A missing field is a correct answer.
- Write summaries in English regardless of document language. Keep titles and
  issuer names in the original language exactly as printed.

Retention — be conservative. This decides whether someone throws away an original:
- keep_original: has legal, tax, or ownership significance, or is required in
  original form (contracts, deeds, certificates, official seals/印鑑証明).
- keep_temporarily: needed until an action completes or a period lapses
  (an unpaid bill, a warranty still running).
- digital_sufficient: informational only, reissuable, no legal weight
  (advertising, already-paid receipts for small amounts, notifications).
- unsure: anything you cannot confidently place above.

Never answer digital_sufficient to be helpful. "unsure" is the correct answer
when you are unsure, and the product surfaces it for human review.`;

export async function extract(
  env: Env,
  ocrText: string,
  image: { data: string; mediaType: string } | null,
): Promise<Extraction> {
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
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
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
  return response.parsed_output;
}
