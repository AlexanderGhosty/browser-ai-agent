import type { ToolCall, ToolDefinition } from '../llm/types.js';
import { BrowserActions } from '../browser/actions.js';
import { PageExtractor } from '../browser/extractor.js';
import { toolDefinitions } from './definitions.js';
import { SecurityGuard } from '../security/guard.js';
import { logger } from '../utils/logger.js';
import type { Page } from 'playwright';

export type AskUserCallback = (question: string) => Promise<string>;

export interface ToolExecutionResult {
    result: string;
    isDone: boolean;
    doneSummary?: string;
    needsUserInput: boolean;
    userQuestion?: string;
}

/**
 * Tool registry and executor.
 * Maps tool names to handler functions, validates arguments,
 * and executes tools with security checks.
 */
export class ToolExecutor {
    private actions: BrowserActions;
    private extractor: PageExtractor;
    private securityGuard: SecurityGuard;
    private askUserCallback: AskUserCallback;

    constructor(
        page: Page,
        extractor: PageExtractor,
        securityGuard: SecurityGuard,
        askUserCallback: AskUserCallback,
    ) {
        this.actions = new BrowserActions(page);
        this.extractor = extractor;
        this.securityGuard = securityGuard;
        this.askUserCallback = askUserCallback;
    }

    updatePage(page: Page) {
        this.actions.setPage(page);
    }

    getDefinitions(): ToolDefinition[] {
        return toolDefinitions;
    }

    /**
     * Execute a tool call from the LLM.
     */
    async execute(toolCall: ToolCall, page: Page): Promise<ToolExecutionResult> {
        const { name, arguments: argsStr } = toolCall.function;
        let args: Record<string, any>;

        try {
            args = JSON.parse(argsStr);
        } catch {
            return {
                result: `Error: Invalid JSON arguments for tool "${name}": ${argsStr}`,
                isDone: false,
                needsUserInput: false,
            };
        }

        logger.act(`${name}(${JSON.stringify(args)})`);

        // Security check for potentially destructive actions
        const pageContext = await this.getPageContextForSecurity(page);
        const allowed = await this.securityGuard.checkAction(toolCall, pageContext);
        if (!allowed) {
            return {
                result: 'Action was blocked by user (security check). Try a different approach or ask the user.',
                isDone: false,
                needsUserInput: false,
            };
        }

        try {
            switch (name) {
                case 'navigate': {
                    const result = await this.actions.navigate(args.url);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'click': {
                    const result = await this.actions.click(args.selector);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'type': {
                    const result = await this.actions.type(args.selector, args.text);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'scroll': {
                    const result = await this.actions.scroll(args.direction);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'read_page': {
                    const content = await this.extractor.extract(page);
                    logger.toolResult(name, `Extracted ${content.length} chars of page content`);
                    return { result: content, isDone: false, needsUserInput: false };
                }

                case 'go_back': {
                    const result = await this.actions.goBack();
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'select_option': {
                    const result = await this.actions.selectOption(args.selector, args.value);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'press_key': {
                    const result = await this.actions.pressKey(args.key);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'hover': {
                    const result = await this.actions.hover(args.selector);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'wait': {
                    const result = await this.actions.wait(args.ms);
                    logger.toolResult(name, result);
                    return { result, isDone: false, needsUserInput: false };
                }

                case 'ask_user': {
                    logger.user(`Agent asks: ${args.question}`);
                    const answer = await this.askUserCallback(args.question);
                    return {
                        result: `User answered: ${answer}`,
                        isDone: false,
                        needsUserInput: true,
                        userQuestion: args.question,
                    };
                }

                case 'done': {
                    logger.done(args.summary);
                    return {
                        result: args.summary,
                        isDone: true,
                        doneSummary: args.summary,
                        needsUserInput: false,
                    };
                }

                default:
                    return {
                        result: `Unknown tool: "${name}". Available tools: ${toolDefinitions.map(t => t.function.name).join(', ')}`,
                        isDone: false,
                        needsUserInput: false,
                    };
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Tool ${name} failed: ${msg}`);
            return {
                result: `Tool "${name}" execution error: ${msg}`,
                isDone: false,
                needsUserInput: false,
            };
        }
    }

    private async getPageContextForSecurity(page: Page): Promise<string> {
        try {
            const title = await page.title();
            const url = page.url();
            return `${title} (${url})`;
        } catch {
            return 'unknown page';
        }
    }
}
