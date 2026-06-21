import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

if (!env.ANTHROPIC_API_KEY) {
  logger.warn("ANTHROPIC_API_KEY not set — AI data layer endpoints will fail until it's configured");
}

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "" });
