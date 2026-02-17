import type OpenAI from 'openai';

// ── Message types matching OpenAI chat format ──

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SystemMessage {
    role: 'system';
    content: string;
}

export interface UserMessage {
    role: 'user';
    content: string;
}

export interface AssistantMessage {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
}

export interface ToolResultMessage {
    role: 'tool';
    tool_call_id: string;
    content: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ── Tool calling types ──

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export type ToolDefinition = OpenAI.Chat.Completions.ChatCompletionTool;

// ── LLM response ──

export interface LLMResponse {
    content: string | null;
    toolCalls: ToolCall[] | null;
    finishReason: string | null;
}

// ── Provider interface ──

export interface LLMProvider {
    chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
    readonly name: string;
    readonly model: string;
}
