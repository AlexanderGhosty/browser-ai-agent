import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * Race a promise against a timeout. Prevents indefinite hangs on slow pages.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

/**
 * Extracts page content using Playwright's ARIA snapshot.
 * The ARIA tree is a compact YAML representation of the accessibility tree,
 * which is far more token-efficient than raw HTML.
 */
export class PageExtractor {
    private tokenBudget: number;

    constructor(tokenBudget = 6000) {
        this.tokenBudget = tokenBudget;
    }

    /**
     * Extract a compact representation of the current page state.
     */
    async extract(page: Page): Promise<string> {
        try {
            // Wait for at least DOM content before attempting extraction.
            // Use withTimeout to avoid hanging on pages that never finish loading.
            await withTimeout(
                page.waitForLoadState('domcontentloaded').catch(() => { }),
                10000,
                undefined,
            );

            const url = page.url();
            const title = await withTimeout(page.title(), 5000, 'Loading...');

            // Get ARIA accessibility tree snapshot
            let ariaTree: string;
            try {
                ariaTree = await withTimeout(
                    page.locator('body').ariaSnapshot({ timeout: 10000 }),
                    15000, // outer guard in case ariaSnapshot timeout itself hangs
                    '',
                );
                if (!ariaTree) {
                    throw new Error('ARIA snapshot returned empty');
                }
            } catch {
                // Fallback: extract text content if ARIA snapshot fails
                logger.system('ARIA snapshot failed, falling back to text extraction');
                ariaTree = await withTimeout(this.fallbackExtract(page), 10000, '[Page content unavailable]');
            }

            // Truncate to token budget
            const truncated = this.truncateToTokenBudget(ariaTree);

            // Get scroll position info
            const scrollInfo = await withTimeout(
                page.evaluate(() => {
                    const scrollY = window.scrollY;
                    const totalHeight = document.documentElement.scrollHeight;
                    const viewportHeight = window.innerHeight;
                    const scrollPercent = totalHeight > viewportHeight
                        ? Math.round((scrollY / (totalHeight - viewportHeight)) * 100)
                        : 100;
                    return `Scroll: ${scrollPercent}% (${Math.round(scrollY)}px / ${totalHeight}px total)`;
                }),
                5000,
                'Scroll: unknown',
            );

            return [
                `Page: ${title}`,
                `URL: ${url}`,
                scrollInfo,
                '',
                'Accessibility Tree:',
                truncated,
            ].join('\n');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Error extracting page content: ${msg}`;
        }
    }

    /**
     * Fallback extraction when ARIA snapshot is unavailable.
     * Gets text content with structural hints.
     */
    private async fallbackExtract(page: Page): Promise<string> {
        const content = await page.evaluate(() => {
            const elements: string[] = [];

            function walk(node: Element, depth: number) {
                const tag = node.tagName.toLowerCase();
                const role = node.getAttribute('role');
                const ariaLabel = node.getAttribute('aria-label');
                const text = node.childNodes.length === 1 && node.childNodes[0].nodeType === 3
                    ? (node.childNodes[0].textContent || '').trim()
                    : '';

                const indent = '  '.repeat(depth);
                let line = `${indent}- ${role || tag}`;

                if (ariaLabel) line += ` "${ariaLabel}"`;
                else if (text && text.length < 100) line += ` "${text}"`;

                // Include clickable/interactive hints
                if (tag === 'a') {
                    const href = node.getAttribute('href');
                    if (href) line += ` [href=${href}]`;
                }
                if (tag === 'input') {
                    const type = node.getAttribute('type') || 'text';
                    const placeholder = node.getAttribute('placeholder');
                    line += ` [type=${type}]`;
                    if (placeholder) line += ` [placeholder="${placeholder}"]`;
                }
                if (tag === 'button' || role === 'button') {
                    line += ' [clickable]';
                }

                elements.push(line);

                // Recurse into children (limit depth)
                if (depth < 6) {
                    for (const child of node.children) {
                        walk(child, depth + 1);
                    }
                }
            }

            walk(document.body, 0);
            return elements.join('\n');
        });

        return content;
    }

    /**
     * Truncate content to fit within the token budget.
     * Rough heuristic: 1 token ≈ 4 characters.
     */
    private truncateToTokenBudget(content: string): string {
        const maxChars = this.tokenBudget * 4;

        if (content.length <= maxChars) {
            return content;
        }

        // Keep the beginning (most important — visible area) and add truncation notice
        const truncated = content.slice(0, maxChars);
        const lastNewline = truncated.lastIndexOf('\n');
        const cleanTruncated = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;

        return cleanTruncated + '\n\n[... content truncated due to length ...]';
    }
}
