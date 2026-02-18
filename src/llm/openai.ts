import OpenAI from 'openai';
import type { Message, ToolDefinition, LLMResponse, LLMProvider, ToolCall } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * OpenAI provider (GPT-4o, etc.).
 * Standard OpenAI endpoint — swap-in replacement for GLM.
 */
export class OpenAIProvider implements LLMProvider {
    readonly name = 'OpenAI';
    readonly model: string;
    private client: OpenAI;

    constructor(apiKey: string, model = 'gpt-5-mini') {
        this.model = model;
        this.client = new OpenAI({ apiKey });
    }

    async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
        try {
            const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
                model: this.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                // temperature: 0.3,
            };

            if (tools.length > 0) {
                params.tools = tools;
                params.tool_choice = 'auto';
            }

            const response = await this.client.chat.completions.create(params);
            const choice = response.choices[0];

            if (!choice) {
                throw new Error('No response choice from OpenAI API');
            }

            const toolCalls = choice.message.tool_calls?.map((tc): ToolCall => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            })) ?? null;

            return {
                content: choice.message.content,
                toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
                finishReason: choice.finish_reason,
                usage: response.usage ? {
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                    total_tokens: response.usage.total_tokens,
                } : undefined,
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`OpenAI API error: ${msg}`);
            throw error;
        }
    }
}
