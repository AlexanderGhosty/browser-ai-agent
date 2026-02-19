import type { LLMProvider, ToolCall } from '../llm/types.js';
import type { Page } from 'playwright';
import { ContextManager } from './context.js';
import { formatObservation, buildFinalSummaryPrompt } from './prompts.js';
import { PageExtractor } from '../browser/extractor.js';
import { ToolExecutor, type AskUserCallback } from '../tools/executor.js';
import { SecurityGuard } from '../security/guard.js';
import { logger } from '../utils/logger.js';
import { BrowserManager } from '../browser/manager.js';

export interface AgentOptions {
    llm: LLMProvider;
    maxIterations: number;
    askUserCallback: AskUserCallback;
}

/**
 * The main autonomous browser agent.
 * Implements the observe → think → act loop.
 * 
 * This class orchestrates the agent's behavior by:
 * 1. Extracting the current page state (observation)
 * 2. Sending the state and conversation history to the LLM (thought)
 * 3. Executing the tool calls returned by the LLM (action)
 * 4. Preventing loops and handling errors
 */
export class BrowserAgent {
    private llm: LLMProvider;
    private context: ContextManager;
    private extractor: PageExtractor;
    private toolExecutor: ToolExecutor;
    private browserManager: BrowserManager;
    private maxIterations: number;
    private page: Page;
    private isDone: boolean = false;
    private summary: string = '';

    constructor(browserManager: BrowserManager, options: AgentOptions) {
        this.browserManager = browserManager;
        this.page = browserManager.getActivePage();
        this.llm = options.llm;
        this.maxIterations = options.maxIterations;
        this.context = new ContextManager();
        this.extractor = new PageExtractor();
        this.toolExecutor = new ToolExecutor(
            this.page,
            this.extractor,
            new SecurityGuard(options.askUserCallback),
            options.askUserCallback,
        );
    }

    /**
     * Run the agent on a task.
     * Returns a summary of what was accomplished.
     * 
     * The run loop continues until:
     * - The task is completed (LLM calls 'done')
     * - The maximum number of iterations is reached
     * - A fatal error occurs (e.g., browser closed)
     * 
     * @param task - The natural language task description
     * @returns A distinct summary of the task execution result
     */
    async run(task: string): Promise<string> {
        this.isDone = false;
        this.summary = '';
        this.context.setTask(task);

        logger.system(`Starting task: ${task}`);
        logger.system(`Using LLM: ${this.llm.name} (${this.llm.model})`);
        logger.separator();

        let consecutiveFailures = 0;
        let textOnlyRetries = 0;
        const recentActions: Array<{ action: string; url: string }> = [];

        for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
            if (this.isDone) break;

            try {
                // ── STALE PAGE RECOVERY ──
                // Always get the latest valid page (handles tab closes/opens)
                try {
                    this.page = this.browserManager.getActivePage();
                    this.toolExecutor.updatePage(this.page);
                } catch (e) {
                    logger.error('No open pages found. Aborting task.');
                    return 'Task aborted: Browser windows closed.';
                }

                // ── 1. OBSERVE ──
                const pageContent = await this.extractor.extract(this.page);
                const observation = formatObservation(pageContent, iteration, this.maxIterations);

                let title = 'Unknown';
                try {
                    title = await Promise.race([
                        this.page.title(),
                        new Promise<string>((_, reject) =>
                            setTimeout(() => reject(new Error('title timeout')), 5000)
                        ),
                    ]);
                } catch { }

                logger.observe(
                    `${title} | ${this.page.url()} (step ${iteration}/${this.maxIterations})`
                );

                this.context.addObservation(observation);

                // ── 2. THINK ──
                const messages = this.context.getMessages();
                const tools = this.toolExecutor.getDefinitions();

                const response = await this.llm.chat(messages, tools);

                if (response.usage) {
                    const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
                    logger.system(`Token Usage: Prompt ${prompt_tokens} + Completion ${completion_tokens} = ${total_tokens}`);
                }

                // ── 3. ACT ──
                if (response.toolCalls && response.toolCalls.length > 0) {
                    textOnlyRetries = 0; // Reset text retry counter
                    this.context.addAssistantMessage(response.content, response.toolCalls);

                    // Execute tool calls in sequence
                    for (const toolCall of response.toolCalls) {
                        // Loop/Stuck Detection (URL-aware)
                        const toolDesc = `${toolCall.function.name}(${toolCall.function.arguments})`;
                        const currentUrl = this.page.url();
                        if (this.isStuck(recentActions, toolDesc, currentUrl)) {
                            const stuckMsg = `You are repeating the action "${toolCall.function.name}" with the same arguments on the same page, which seems ineffective. STOP. Try a different approach (search, tab navigation, or ask_user).`;
                            logger.system(`⚠ Loop detected: ${toolDesc}. Injecting warning.`);
                            this.context.addToolResult(toolCall, stuckMsg);
                            continue; // Skip execution, force rethink
                        }
                        recentActions.push({ action: toolDesc, url: currentUrl });
                        if (recentActions.length > 10) recentActions.shift();

                        // Execute
                        const result = await this.toolExecutor.execute(toolCall, this.page);

                        // Refresh page reference after every action (page may have been replaced)
                        try {
                            await this.browserManager.closeExtraTabs();
                            this.page = this.browserManager.getActivePage();
                            this.toolExecutor.updatePage(this.page);
                        } catch { /* will be caught at start of next iteration */ }

                        // Add result
                        this.context.addToolResult(toolCall, result.result);

                        if (result.isDone) {
                            this.isDone = true;
                            this.summary = result.doneSummary || 'Task completed';
                            break;
                        }
                    }
                    consecutiveFailures = 0;
                } else if (response.content) {
                    // LLM spoke without tools
                    logger.think(response.content);
                    this.context.addAssistantMessage(response.content);

                    // Force tool usage if strictly chatting (unless it looks like a completion)
                    // Heuristic: if it looks like a question to user but didn't use ask_user
                    if (response.content.includes('?') && textOnlyRetries < 2) {
                        textOnlyRetries++;
                        const warning = "You sent a text response but did not call a tool. If you need to ask the user a question, you MUST use the `ask_user` tool. Do not just write text. Please try again.";
                        logger.system(`⚠️ LLM sent text only. Retrying (${textOnlyRetries}/2) with warning.`);
                        this.context.addObservation(warning);
                        // Decrement iteration count to not waste steps? No, keep it simple.
                        continue;
                    }

                    // Check for "done" without tool
                    if (
                        response.finishReason === 'stop' &&
                        ['task', 'complete', 'finished', 'done'].some(kw => response.content?.toLowerCase().includes(kw))
                    ) {
                        this.isDone = true;
                        this.summary = response.content;
                    } else if (textOnlyRetries < 2) {
                        textOnlyRetries++;
                        this.context.addObservation("Please call a tool to proceed. Use `ask_user` if you need input, or `done` if finished.");
                    }
                } else {
                    logger.error('LLM returned empty response — retrying...');
                    consecutiveFailures++;
                }

            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.error(`Iteration ${iteration} error: ${msg}`);
                consecutiveFailures++;

                // Remove the observation we already added this iteration
                // to avoid orphaned user messages when the LLM call fails.
                // The next iteration will add a fresh observation automatically.
                this.context.removeLastObservation();

                if (consecutiveFailures > 3) {
                    this.summary = "Task failed: Too many consecutive errors.";
                    this.isDone = true;
                }
            }
        }

        if (!this.isDone) {
            logger.error(`Task stopped after reaching maximum iterations (${this.maxIterations}).`);
            // Generate a final summary from the LLM
            this.summary = await this.generateFinalSummary(task);
        }

        logger.separator();
        return this.summary;
    }

    /**
     * Generate a summary when the agent hits the iteration limit.
     * Makes one final LLM call with only the `done` tool available.
     * used to ensure the user gets a structured result even if the agent ran out of steps.
     * 
     * @param task - The original task description
     * @returns A generated summary string
     */
    private async generateFinalSummary(task: string): Promise<string> {
        try {
            const summaryPrompt = buildFinalSummaryPrompt(task);
            const messages = this.context.getMessages();
            // Append a user message asking for summary
            messages.push({ role: 'user', content: summaryPrompt });

            // Only provide the `done` tool to force a structured summary
            const doneToolOnly = this.toolExecutor.getDefinitions().filter(t => t.function.name === 'done');

            const response = await this.llm.chat(messages, doneToolOnly);

            // Extract summary from tool call or text
            if (response.toolCalls && response.toolCalls.length > 0) {
                const args = JSON.parse(response.toolCalls[0].function.arguments);
                const summary = args.summary || 'Task incomplete — max iterations reached.';
                logger.done(summary);
                return summary;
            }

            if (response.content) {
                logger.done(response.content);
                return response.content;
            }

            return `Task incomplete: reached ${this.maxIterations} iterations. Re-run to continue.`;
        } catch (error) {
            logger.error(`Failed to generate final summary: ${error instanceof Error ? error.message : error}`);
            return `Task incomplete: reached ${this.maxIterations} iterations. Re-run to continue.`;
        }
    }

    /**
     * URL-aware loop detection.
     * Only flags as stuck when the same action is repeated on the SAME page URL.
     * This allows legitimate repeated actions (e.g. clicking "next" on different emails).
     * 
     * Strategies:
     * 1. Exact repetition: Same action & arguments on same URL 3 times in a row.
     * 2. Oscillating loop: Visiting the same URL 3+ times in the recent window.
     * 
     * @param recentActions - History of recent actions
     * @param currentAction - The proposed action string
     * @param currentUrl - The current page URL
     * @returns True if a loop is detected
     */
    private isStuck(recentActions: Array<{ action: string; url: string }>, currentAction: string, currentUrl: string): boolean {
        // Check 1: Exact repetition (3 times same action on same URL)
        if (recentActions.length >= 2) {
            const last = recentActions[recentActions.length - 1];
            const secondLast = recentActions[recentActions.length - 2];
            if (
                last.action === currentAction && last.url === currentUrl &&
                secondLast.action === currentAction && secondLast.url === currentUrl
            ) {
                return true;
            }
        }

        // Check 2: Oscillating loop detection (re-entering same URL repeatedly)
        // We look at the combined history of recent actions plus the current one.
        const allActions = [...recentActions, { action: currentAction, url: currentUrl }];

        let visits = 0;
        for (let i = 0; i < allActions.length; i++) {
            if (allActions[i].url === currentUrl) {
                // Count a visit if it's the first action in the window OR if the previous URL was different
                if (i === 0 || allActions[i - 1].url !== currentUrl) {
                    visits++;
                }
            }
        }

        // If the agent has RE-ENTERED the same page 3 or more times, it's likely stuck in a loop
        if (visits >= 3) {
            return true;
        }

        return false;
    }
}
