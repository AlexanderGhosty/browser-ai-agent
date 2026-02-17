import type { ToolCall } from '../llm/types.js';
import { logger } from '../utils/logger.js';

type ConfirmCallback = (question: string) => Promise<string>;

/**
 * Destructive action keywords in Russian and English.
 * These trigger a user confirmation before execution.
 */
const DESTRUCTIVE_KEYWORDS = [
    // Russian
    'удалить', 'удаление', 'оплатить', 'оплата', 'отправить', 'подтвердить',
    'купить', 'заказать', 'отменить', 'отписаться', 'перевести', 'перевод',
    'подписать', 'согласиться', 'удалить аккаунт', 'сбросить',
    // English
    'delete', 'remove', 'pay', 'payment', 'checkout', 'submit', 'send',
    'purchase', 'buy', 'order', 'confirm', 'cancel', 'unsubscribe',
    'transfer', 'sign', 'agree', 'delete account', 'reset',
];

/**
 * Tool actions that are inherently destructive.
 */
const DESTRUCTIVE_TOOL_PATTERNS: Array<{ tool: string; argPattern: RegExp }> = [
    // Click on something related to payment/deletion/submission
    { tool: 'click', argPattern: /удалить|delete|pay|оплат|submit|отправ|купить|buy|checkout|заказ|order|confirm|подтверд/i },
    { tool: 'press_key', argPattern: /Enter/i }, // Enter on a form might submit it — check page context
];

/**
 * Security guard that detects potentially destructive actions
 * and asks for user confirmation before allowing execution.
 */
export class SecurityGuard {
    private confirmCallback: ConfirmCallback;

    constructor(confirmCallback: ConfirmCallback) {
        this.confirmCallback = confirmCallback;
    }

    /**
     * Check if a tool call is potentially destructive.
     * Returns true if the action is allowed, false if blocked.
     */
    async checkAction(toolCall: ToolCall, pageContext: string): Promise<boolean> {
        const { name, arguments: argsStr } = toolCall.function;

        // Meta-tools are always safe
        if (['read_page', 'scroll', 'wait', 'ask_user', 'done', 'hover', 'go_back', 'navigate'].includes(name)) {
            return true;
        }

        const isDestructive = this.isDestructiveAction(name, argsStr, pageContext);

        if (isDestructive) {
            logger.security(`Potentially destructive action detected!`);
            logger.security(`Action: ${name}(${argsStr})`);
            logger.security(`Page: ${pageContext}`);

            const answer = await this.confirmCallback(
                `⚠️  This action may be destructive (payment, deletion, submission).\n` +
                `   Action: ${name}(${argsStr})\n` +
                `   Page: ${pageContext}\n` +
                `   Allow this action? (y/n)`
            );

            const allowed = answer.toLowerCase().startsWith('y');
            if (!allowed) {
                logger.security('Action BLOCKED by user');
            } else {
                logger.security('Action ALLOWED by user');
            }
            return allowed;
        }

        return true;
    }

    /**
     * Determine if an action is destructive based on tool name, arguments,
     * and the current page context.
     */
    private isDestructiveAction(toolName: string, argsStr: string, pageContext: string): boolean {
        // Check tool-specific patterns
        for (const pattern of DESTRUCTIVE_TOOL_PATTERNS) {
            if (toolName === pattern.tool && pattern.argPattern.test(argsStr)) {
                return true;
            }
        }

        // For click/type/press_key actions, check if page context suggests destructive operation
        if (['click', 'type', 'press_key', 'select_option'].includes(toolName)) {
            const contextLower = pageContext.toLowerCase();
            const argsLower = argsStr.toLowerCase();

            for (const keyword of DESTRUCTIVE_KEYWORDS) {
                // Keyword in the arguments (what we're clicking/typing)
                if (argsLower.includes(keyword)) {
                    return true;
                }
                // Keyword in page context AND we're clicking something
                if (contextLower.includes(keyword) && toolName === 'click') {
                    // Only flag if the page title/URL strongly suggests destructive context
                    if (
                        contextLower.includes('checkout') ||
                        contextLower.includes('оплат') ||
                        contextLower.includes('корзин') ||
                        contextLower.includes('удален') ||
                        contextLower.includes('подтвержд')
                    ) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
