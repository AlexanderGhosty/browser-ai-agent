import type { LLMProvider } from './types.js';
import type { Config } from '../utils/config.js';
import { GLMProvider } from './glm.js';
import { OpenAIProvider } from './openai.js';

/**
 * Factory: creates the right LLM provider based on config.
 */
export function createLLMProvider(config: Config): LLMProvider {
    switch (config.llmProvider) {
        case 'glm':
            return new GLMProvider(config.glmApiKey);
        case 'openai':
            return new OpenAIProvider(config.openaiApiKey);
        case 'claude':
            // Claude uses a different SDK; for now, route through OpenAI-compatible proxy
            // or implement Anthropic SDK separately
            throw new Error(
                'Claude provider not yet implemented. Use glm or openai.'
            );
        default:
            throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
    }
}

export type { LLMProvider, LLMResponse, Message, ToolCall, ToolDefinition } from './types.js';
