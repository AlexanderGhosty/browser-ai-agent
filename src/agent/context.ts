import type { Message, ToolCall } from '../llm/types.js';
import { buildSystemPrompt, summarizeActions } from './prompts.js';

/**
 * Manages the conversation context within a token budget.
 * Implements a sliding window with action history compression.
 */
export class ContextManager {
    private messages: Message[] = [];
    private task: string = '';
    private actionHistory: string[] = [];
    private maxHistoryMessages: number;
    private tokenBudget: number;

    constructor(maxHistoryMessages = 10, tokenBudget = 8000) {
        this.maxHistoryMessages = maxHistoryMessages;
        this.tokenBudget = tokenBudget;
    }

    /**
     * Set the current task and initialize the system prompt.
     */
    setTask(task: string) {
        this.task = task;
        this.messages = [];
        this.actionHistory = [];
    }

    /**
     * Build the full message list for the LLM call.
     * Applies context compression to stay within token budget.
     */
    getMessages(): Message[] {
        const systemMessage: Message = {
            role: 'system',
            content: buildSystemPrompt(this.task),
        };

        // Build compressed context
        const result: Message[] = [systemMessage];

        // Add action history summary if we have compressed history
        if (this.actionHistory.length > 0) {
            const summary = summarizeActions(this.actionHistory);
            result.push({
                role: 'user',
                content: summary,
            });
        }

        // Add recent messages (sliding window)
        const recentMessages = this.getRecentMessages();
        result.push(...recentMessages);

        return result;
    }

    /**
     * Add an observation (page state) as a user message.
     */
    addObservation(content: string) {
        this.messages.push({
            role: 'user',
            content,
        });
        this.compressIfNeeded();
    }

    /**
     * Add the assistant's response (with tool calls).
     */
    addAssistantMessage(content: string | null, toolCalls?: ToolCall[]) {
        this.messages.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls,
        });
    }

    /**
     * Add a tool execution result.
     */
    addToolResult(toolCall: ToolCall, result: string) {
        this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
        });

        // Track in action history for compression
        // Preserve longer summaries for rich content (e.g., resume pages)
        const summaryLen = result.length > 1000 ? 300 : 100;
        try {
            const args = JSON.parse(toolCall.function.arguments);
            const argStr = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
            this.actionHistory.push(`${toolCall.function.name}(${argStr}) → ${result.slice(0, summaryLen)}`);
        } catch {
            this.actionHistory.push(`${toolCall.function.name} → ${result.slice(0, summaryLen)}`);
        }
    }

    /**
     * Remove the last observation (user message) from context.
     * Used during error recovery to avoid orphaned observations.
     */
    removeLastObservation() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user') {
                this.messages.splice(i, 1);
                return;
            }
        }
    }

    /**
     * Find a safe start index for the sliding window.
     * OpenAI requires every 'tool' message to follow an 'assistant' message
     * with tool_calls. Never start the window on a 'tool' message.
     */
    private findSafeWindowStart(targetStart: number): number {
        let start = targetStart;
        while (start > 0 && this.messages[start].role === 'tool') {
            start--;
        }
        return start;
    }

    /**
     * Get recent messages within the sliding window.
     * Ensures the window never splits assistant(tool_calls) from tool results.
     */
    private getRecentMessages(): Message[] {
        if (this.messages.length <= this.maxHistoryMessages) {
            return [...this.messages];
        }

        const targetStart = this.messages.length - this.maxHistoryMessages;
        const safeStart = this.findSafeWindowStart(targetStart);
        return this.messages.slice(safeStart);
    }

    /**
     * Compress context if we're exceeding the budget.
     * Moves older messages into the action history summary.
     */
    private compressIfNeeded() {
        const totalTokens = this.estimateTokens(this.messages);

        if (totalTokens > this.tokenBudget && this.messages.length > this.maxHistoryMessages) {
            // Find safe cut point that doesn't split tool_calls from tool results
            const targetStart = this.messages.length - this.maxHistoryMessages;
            const safeStart = this.findSafeWindowStart(targetStart);
            this.messages = this.messages.slice(safeStart);

            // Already tracked in actionHistory via addToolResult, so we just trim messages
        }
    }

    /**
     * Rough token estimation: 1 token ≈ 4 characters.
     */
    private estimateTokens(messages: Message[]): number {
        let total = 0;
        for (const msg of messages) {
            if (msg.content) {
                total += Math.ceil(msg.content.length / 4);
            }
            if ('tool_calls' in msg && msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    total += Math.ceil(tc.function.arguments.length / 4) + 10;
                }
            }
        }
        return total;
    }

    /**
     * Clear all context.
     */
    clear() {
        this.messages = [];
        this.actionHistory = [];
        this.task = '';
    }
}
