import type { LLMProvider } from '../llm/types.js';
import type { Page } from 'playwright';
import { ContextManager } from './context.js';
import { formatObservation } from './prompts.js';
import { PageExtractor } from '../browser/extractor.js';
import { ToolExecutor, type AskUserCallback } from '../tools/executor.js';
import { SecurityGuard } from '../security/guard.js';
import { logger } from '../utils/logger.js';

export interface AgentOptions {
    llm: LLMProvider;
    maxIterations: number;
    askUserCallback: AskUserCallback;
}

/**
 * The main autonomous browser agent.
 * Implements the observe → think → act loop.
 */
export class BrowserAgent {
    private llm: LLMProvider;
    private context: ContextManager;
    private extractor: PageExtractor;
    private toolExecutor: ToolExecutor;
    private maxIterations: number;
    private page: Page;
    private isDone: boolean = false;
    private summary: string = '';

    constructor(page: Page, options: AgentOptions) {
        this.page = page;
        this.llm = options.llm;
        this.maxIterations = options.maxIterations;
        this.context = new ContextManager();
        this.extractor = new PageExtractor();
        this.toolExecutor = new ToolExecutor(
            page,
            this.extractor,
            new SecurityGuard(options.askUserCallback),
            options.askUserCallback,
        );
    }

    /**
     * Run the agent on a task.
     * Returns a summary of what was accomplished.
     */
    async run(task: string): Promise<string> {
        this.isDone = false;
        this.summary = '';
        this.context.setTask(task);

        logger.system(`Starting task: ${task}`);
        logger.system(`Using LLM: ${this.llm.name} (${this.llm.model})`);
        logger.separator();

        for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
            if (this.isDone) break;

            try {
                // Ensure we're working with the current active page
                this.toolExecutor.updatePage(this.page);

                // ── 1. OBSERVE ──
                const pageContent = await this.extractor.extract(this.page);
                const observation = formatObservation(pageContent, iteration, this.maxIterations);

                logger.observe(
                    `${await this.page.title()} | ${this.page.url()} (step ${iteration}/${this.maxIterations})`
                );

                this.context.addObservation(observation);

                // ── 2. THINK ──
                const messages = this.context.getMessages();
                const tools = this.toolExecutor.getDefinitions();

                const response = await this.llm.chat(messages, tools);

                // ── 3. ACT ──
                if (response.toolCalls && response.toolCalls.length > 0) {
                    // Add assistant message with tool calls to context
                    this.context.addAssistantMessage(response.content, response.toolCalls);

                    // Execute each tool call (usually just one)
                    for (const toolCall of response.toolCalls) {
                        const result = await this.toolExecutor.execute(toolCall, this.page);

                        // Add tool result to context
                        this.context.addToolResult(toolCall, result.result);

                        if (result.isDone) {
                            this.isDone = true;
                            this.summary = result.doneSummary || 'Task completed';
                            break;
                        }
                    }
                } else if (response.content) {
                    // Agent is speaking without tool calls — log it
                    logger.think(response.content);
                    this.context.addAssistantMessage(response.content);

                    // Check if the model thinks we're done but didn't use the done tool
                    if (
                        response.finishReason === 'stop' &&
                        response.content.toLowerCase().includes('task') &&
                        (response.content.toLowerCase().includes('complete') ||
                            response.content.toLowerCase().includes('done') ||
                            response.content.toLowerCase().includes('finish'))
                    ) {
                        this.isDone = true;
                        this.summary = response.content;
                    }
                } else {
                    logger.error('LLM returned empty response — retrying...');
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.error(`Iteration ${iteration} error: ${msg}`);

                // Add error to context so the agent can adapt
                this.context.addObservation(`Error occurred: ${msg}. Please try a different approach.`);
            }
        }

        if (!this.isDone) {
            this.summary = `Task stopped after reaching maximum iterations (${this.maxIterations}). The task may not be fully complete.`;
            logger.error(this.summary);
        }

        logger.separator();
        return this.summary;
    }

    /**
     * Update the page reference (e.g., when a new tab opens).
     */
    setPage(page: Page) {
        this.page = page;
        this.toolExecutor.updatePage(page);
    }
}
