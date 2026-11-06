import { config } from "./config";

/** Which fallback answers when 0G is off (development only). */
export function llmMode(): "anthropic" | "offline" {
  return config.llm.apiKey ? "anthropic" : "offline";
}
