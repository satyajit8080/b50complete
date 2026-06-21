import { anthropic } from "./client.js";
import { env } from "../../config/env.js";
import { cached } from "../../lib/cache.js";
import { logger } from "../../lib/logger.js";

export type AiInsightType =
  | "MARKET_MOVEMENT"
  | "STOCK_MOVEMENT"
  | "COMPANY_SUMMARY"
  | "OPTION_CHAIN_EXPLAIN"
  | "RESULTS_SUMMARY"
  | "INVESTMENT_SUMMARY"
  | "RISK_ANALYSIS"
  | "BULLISH_BEARISH_VIEW";

interface GenerateInsightOptions {
  type: AiInsightType;
  /** Structured data already computed by Bull50's own services (breadth,
   * top lists, option metrics, quotes, etc.) — never raw upstream API
   * payloads. Keeps prompts compact, consistent, and free of fields the
   * model has no use for. */
  data: Record<string, unknown>;
  /** Cache key suffix — callers should include enough of `data` to avoid
   * serving stale insight for materially different inputs (e.g. symbol + a
   * rounded timestamp bucket). */
  cacheKeySuffix: string;
  maxTokens?: number;
}

const SYSTEM_PROMPTS: Record<AiInsightType, string> = {
  MARKET_MOVEMENT:
    "You are Bull50's market analyst. Given structured market breadth and index data, explain today's overall market movement in 2-3 plain-English sentences for a retail Indian trader. Be factual and specific to the numbers given — never speculate beyond the data provided.",
  STOCK_MOVEMENT:
    "You are Bull50's stock analyst. Given a stock's price action, volume, and any available news context, explain why the stock likely moved in 2-3 sentences. If the data doesn't support a confident explanation, say so plainly rather than guessing.",
  COMPANY_SUMMARY:
    "You are Bull50's research analyst. Given structured company fundamentals, write a concise 3-4 sentence summary covering business, scale, and financial health. Factual only — no investment recommendation.",
  OPTION_CHAIN_EXPLAIN:
    "You are Bull50's options analyst. Given option chain metrics (PCR, Max Pain, OI changes, IV), explain in 2-3 sentences what the data suggests about market positioning. State this as an observation about current data, not a prediction.",
  RESULTS_SUMMARY:
    "You are Bull50's earnings analyst. Given quarterly/annual results data, summarize the key numbers and YoY/QoQ changes in 3-4 sentences. Stick strictly to the figures provided.",
  INVESTMENT_SUMMARY:
    "You are Bull50's research analyst. Given company fundamentals and valuation metrics, write a balanced 3-4 sentence summary of strengths and concerns visible in the data. This is informational only, not financial advice — do not phrase it as a recommendation to buy or sell.",
  RISK_ANALYSIS:
    "You are Bull50's risk analyst. Given portfolio or position data, identify 2-3 concrete risk factors visible in the structured data (concentration, volatility, leverage, sector exposure). Be specific and avoid generic disclaimers beyond what's necessary.",
  BULLISH_BEARISH_VIEW:
    "You are Bull50's technical analyst. Given price action, volume, and indicator data, state whether the structured data leans bullish, bearish, or neutral and give the 2-3 specific data points driving that read. This is a read of the data, not a trade recommendation.",
};

/**
 * Generates an AI insight from Bull50's own structured/computed data
 * (never raw upstream payloads — keeps cost, latency, and prompt
 * consistency under control, and means the AI's output is always
 * traceable to a specific, named data shape).
 */
export async function generateAiInsight(options: GenerateInsightOptions): Promise<string> {
  const cacheKey = `ai:insight:${options.type}:${options.cacheKeySuffix}`;

  return cached(cacheKey, { ttlSeconds: 300 }, async () => {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("AI data layer is not configured — ANTHROPIC_API_KEY is missing");
    }

    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: options.maxTokens ?? 400,
      system: SYSTEM_PROMPTS[options.type],
      messages: [
        {
          role: "user",
          content: `Structured data:\n${JSON.stringify(options.data, null, 2)}\n\nGenerate the insight per your instructions.`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      logger.warn({ type: options.type }, "AI response contained no text block");
      return "Unable to generate insight at this time.";
    }

    return textBlock.text;
  });
}
