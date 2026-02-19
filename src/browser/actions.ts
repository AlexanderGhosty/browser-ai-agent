import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * Low-level browser action wrappers with error handling.
 * Each action returns a string result suitable for sending back to the LLM.
 * 
 * Features:
 * - Robust selector resolution (ARIA, text, CSS).
 * - Automatic retries for "strict mode" violations (ambiguous selectors).
 * - Fallback strategies for difficult clicks (dispatchEvent).
 * - Descriptive success/failure messages for the LLM.
 */
export class BrowserActions {
    private page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    /**
     * Update the page reference (called after navigations or tab switches).
     */
    setPage(page: Page) {
        this.page = page;
    }

    /**
     * Navigate to a URL.
     */
    async navigate(url: string): Promise<string> {
        try {
            // Add protocol if missing
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }

            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(1000); // Small delay for dynamic content
            const title = await this.page.title();
            return `Navigated to ${url} — page title: "${title}"`;
        } catch (error) {
            return `Navigation failed: ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Click on an element identified by a selector string.
     * Supports CSS selectors, text selectors, and role-based selectors.
     */
    async click(selector: string): Promise<string> {
        try {
            const locator = this.resolveLocator(selector);
            await locator.click({ timeout: 7000 });
            await this.page.waitForTimeout(800);
            return `Clicked on "${selector}" successfully`;
        } catch (error) {
            // Handle strict mode violation — auto-pick the first visible match
            if (error instanceof Error && error.message.includes('strict mode violation')) {
                try {
                    const locator = this.resolveLocator(selector);
                    await locator.first().click({ timeout: 7000 });
                    await this.page.waitForTimeout(800);
                    return `Clicked on the FIRST match for "${selector}" (multiple elements found). TIP: For listing pages with many identical buttons, navigate to the individual item page first, then perform the action there.`;
                } catch (retryError) {
                    return `Click failed on "${selector}" (strict mode, first() also failed): ${retryError instanceof Error ? retryError.message : retryError}`;
                }
            }

            // If timeout and locator was resolved (element exists but blocked by overlay/animation),
            // retry with dispatchEvent('click') which fires directly on the element's JS handler,
            // bypassing both actionability checks AND coordinate-based dispatch (no overlay issue)
            if (error instanceof Error && error.message.includes('Timeout')) {
                const urlBefore = this.page.url();
                try {
                    const locator = this.resolveLocator(selector);
                    await this.page.waitForTimeout(500); // Let animations finish
                    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
                    // Use dispatchEvent instead of click({force:true}) — dispatches directly
                    // to the element without coordinate-based clicking through overlays
                    await locator.dispatchEvent('click');
                    await this.page.waitForTimeout(1000);
                    const urlAfter = this.page.url();
                    // If URL changed, the click worked
                    if (urlAfter !== urlBefore) {
                        return `Clicked on "${selector}" successfully (dispatchEvent fallback)`;
                    }
                    // URL didn't change — try evaluate fallback
                    await locator.evaluate((el: HTMLElement) => el.click());
                    await this.page.waitForTimeout(1000);
                    const urlFinal = this.page.url();
                    if (urlFinal !== urlBefore) {
                        return `Clicked on "${selector}" successfully (evaluate fallback)`;
                    }
                    // For buttons (not links), click may succeed without URL change
                    if (selector.toLowerCase().includes('button')) {
                        return `Clicked on "${selector}" successfully (dispatchEvent on button)`;
                    }
                    return `Click on "${selector}" was dispatched but the page did NOT change. The element may be covered by an overlay or the selector is wrong. Try a different selector (e.g., text= with the visible text, or use read_page to find the correct element).`;
                } catch (dispatchError) {
                    // If even dispatchEvent fails, try .first() as last resort
                    try {
                        const locator = this.resolveLocator(selector);
                        await locator.first().dispatchEvent('click');
                        await this.page.waitForTimeout(1000);
                        if (selector.toLowerCase().includes('button')) {
                            return `Clicked on "${selector}" successfully (dispatchEvent on first match)`;
                        }
                        const urlCheck = this.page.url();
                        if (urlCheck !== urlBefore) {
                            return `Clicked on "${selector}" successfully (dispatchEvent on first match)`;
                        }
                        return `Click on "${selector}" was dispatched but the page did NOT change. Try a different selector.`;
                    } catch (lastError) {
                        return `Click failed on "${selector}": ${error instanceof Error ? error.message : error}`;
                    }
                }
            }

            return `Click failed on "${selector}": ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Type text into an input element.
     */
    async type(selector: string, text: string): Promise<string> {
        try {
            const locator = this.resolveLocator(selector);
            await locator.fill(text, { timeout: 5000 });
            return `Typed "${text}" into "${selector}"`;
        } catch (error) {
            // Handle strict mode violation — auto-pick the first match
            if (error instanceof Error && error.message.includes('strict mode violation')) {
                try {
                    const locator = this.resolveLocator(selector);
                    await locator.first().fill(text, { timeout: 5000 });
                    return `Typed "${text}" into the FIRST match for "${selector}" (multiple elements found). TIP: Use a more specific selector.`;
                } catch (retryError) {
                    return `Type failed on "${selector}" (strict mode, first() also failed): ${retryError instanceof Error ? retryError.message : retryError}`;
                }
            }
            // If fill doesn't work, try click + type
            try {
                const locator = this.resolveLocator(selector);
                await locator.click({ timeout: 5000 });
                await this.page.keyboard.type(text, { delay: 30 });
                return `Typed "${text}" into "${selector}" (via keyboard)`;
            } catch (retryError) {
                return `Type failed on "${selector}": ${error instanceof Error ? error.message : error}`;
            }
        }
    }

    /**
     * Scroll the page in a direction.
     */
    async scroll(direction: 'up' | 'down'): Promise<string> {
        try {
            const delta = direction === 'down' ? 600 : -600;
            await this.page.mouse.wheel(0, delta);
            await this.page.waitForTimeout(500);

            const scrollY = await this.page.evaluate(() => window.scrollY);
            return `Scrolled ${direction}. Current scroll position: ${Math.round(scrollY)}px`;
        } catch (error) {
            return `Scroll failed: ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Go back to the previous page.
     */
    async goBack(): Promise<string> {
        try {
            const urlBefore = this.page.url();
            await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
            await this.page.waitForTimeout(800);
            const urlAfter = this.page.url();
            const title = await this.page.title();

            // Detect SPA failure: goBack() returned but URL didn't change
            if (urlAfter === urlBefore) {
                return `go_back did NOT work — the page is still "${title}" (${urlAfter}). This site uses client-side routing. Use navigate() with the target URL, or click a link/button to go where you need.`;
            }

            return `Navigated back to "${title}" (${urlAfter})`;
        } catch (error) {
            return `Go back failed: ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Select an option from a dropdown/select element.
     */
    async selectOption(selector: string, value: string): Promise<string> {
        try {
            const locator = this.resolveLocator(selector);
            await locator.selectOption(value, { timeout: 5000 });
            return `Selected "${value}" in "${selector}"`;
        } catch (error) {
            return `Select option failed on "${selector}": ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Press a keyboard key.
     */
    async pressKey(key: string): Promise<string> {
        try {
            await this.page.keyboard.press(key);
            await this.page.waitForTimeout(500);
            return `Pressed key "${key}"`;
        } catch (error) {
            return `Press key failed: ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Hover over an element.
     */
    async hover(selector: string): Promise<string> {
        try {
            const locator = this.resolveLocator(selector);
            await locator.hover({ timeout: 5000 });
            return `Hovered over "${selector}"`;
        } catch (error) {
            // Handle strict mode violation — auto-pick the first match
            if (error instanceof Error && error.message.includes('strict mode violation')) {
                try {
                    const locator = this.resolveLocator(selector);
                    await locator.first().hover({ timeout: 5000 });
                    return `Hovered over the FIRST match for "${selector}" (multiple elements found). TIP: Use a more specific selector.`;
                } catch (retryError) {
                    return `Hover failed on "${selector}" (strict mode, first() also failed): ${retryError instanceof Error ? retryError.message : retryError}`;
                }
            }
            return `Hover failed on "${selector}": ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Wait for a specified time.
     */
    async wait(ms: number): Promise<string> {
        const cappedMs = Math.min(ms, 10000); // Cap at 10 seconds
        await this.page.waitForTimeout(cappedMs);
        return `Waited ${cappedMs}ms`;
    }

    /**
     * Take a screenshot (returns description, not the actual image).
     */
    async screenshot(): Promise<string> {
        try {
            const buffer = await this.page.screenshot({ type: 'png' });
            const sizeKb = Math.round(buffer.length / 1024);
            return `Screenshot taken (${sizeKb}KB). The page is visible in the browser window.`;
        } catch (error) {
            return `Screenshot failed: ${error instanceof Error ? error.message : error}`;
        }
    }

    /**
     * Known ARIA roles for detecting ARIA-format selectors.
     */
    private static readonly ARIA_ROLES = new Set([
        'alert', 'alertdialog', 'application', 'article', 'banner',
        'blockquote', 'button', 'caption', 'cell', 'checkbox',
        'code', 'columnheader', 'combobox', 'complementary',
        'contentinfo', 'definition', 'deletion', 'dialog',
        'directory', 'document', 'emphasis', 'feed', 'figure',
        'form', 'generic', 'grid', 'gridcell', 'group', 'heading',
        'img', 'insertion', 'link', 'list', 'listbox', 'listitem',
        'log', 'main', 'marquee', 'math', 'menu', 'menubar',
        'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter',
        'navigation', 'none', 'note', 'option', 'paragraph',
        'presentation', 'progressbar', 'radio', 'radiogroup',
        'region', 'row', 'rowgroup', 'rowheader', 'scrollbar',
        'search', 'searchbox', 'separator', 'slider', 'spinbutton',
        'status', 'strong', 'subscript', 'superscript', 'switch',
        'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
        'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid',
        'treeitem',
    ]);

    /**
     * Resolve a flexible selector to a Playwright locator.
     * 
     * Strategy:
     * 1. Detect and reject invalid "tree path" selectors (e.g. ROOT > DIV).
     * 2. Check for nested ARIA selectors (dialog "Title" button "Submit").
     * 3. Check for standard ARIA selectors (role "name").
     * 4. specific prefixes: role=, text=, label=, placeholder=.
     * 5. CSS selectors (fallback).
     * 6. Plain text fuzzy match (last resort).
     * 
     * @param selector - The selector string provided by the LLM
     * @returns Playwright Locator
     * @throws Error if selector is clearly invalid (hallucinated tree path)
     */
    private resolveLocator(selector: string) {
        // Strip leading "- " in case the LLM copies the YAML list prefix
        selector = selector.replace(/^-\s+/, '');

        // Reject hallucinated tree-path selectors (e.g., "ROOT > DIV > 1", "LI > ROOT > 1")
        // The LLM sometimes misinterprets ARIA tree indentation as CSS paths
        if (/\bROOT\b/i.test(selector) || /^[A-Z]+\s*>\s*[A-Z]+/i.test(selector) && /\b\d+\b/.test(selector)) {
            throw new Error(
                `Invalid selector "${selector}" — this looks like a tree hierarchy path, not a valid selector. ` +
                `Use ARIA role+name format instead (e.g., button "Submit", link "Home"). ` +
                `Use read_page to see the actual element labels on the page.`
            );
        }

        // ── 0. Nested/scoped ARIA selector: parentRole "parentName" childRole "childName" ──
        // Matches: dialog "Отклик на вакансию" button "Откликнуться"
        const nestedMatch = selector.match(/^(\w+)\s+"(.+?)"\s+(\w+)\s+"(.+)"$/);
        if (nestedMatch) {
            const [, parentRole, parentName, childRole, childName] = nestedMatch;
            if (
                BrowserActions.ARIA_ROLES.has(parentRole.toLowerCase()) &&
                BrowserActions.ARIA_ROLES.has(childRole.toLowerCase())
            ) {
                const parent = this.page.getByRole(parentRole.toLowerCase() as any, { name: parentName });
                return parent.getByRole(childRole.toLowerCase() as any, { name: childName });
            }
        }

        // ── 1. ARIA-format selector: role "name" ──
        // Matches: combobox "Hae", button "Google-haku", link "Home", heading "Title" [level=1]
        const ariaMatch = selector.match(/^(\w+)\s+"(.+)"(\s+\[.*\])?$/);
        if (ariaMatch) {
            const [, role, name] = ariaMatch;
            if (BrowserActions.ARIA_ROLES.has(role.toLowerCase())) {
                return this.page.getByRole(role.toLowerCase() as any, { name });
            }
        }

        // Also match ARIA format without quotes: combobox Search
        const ariaNoQuoteMatch = selector.match(/^(\w+)\s+(.+)$/);
        if (ariaNoQuoteMatch) {
            const [, role, name] = ariaNoQuoteMatch;
            if (BrowserActions.ARIA_ROLES.has(role.toLowerCase()) && !name.includes('=')) {
                return this.page.getByRole(role.toLowerCase() as any, { name });
            }
        }

        // ── 2. Explicit role= prefix: role=button[name='Submit'] ──
        if (selector.startsWith('role=')) {
            const roleMatch = selector.match(/^role=(\w+)(?:\[name=['"](.+)['"]\])?$/);
            if (roleMatch) {
                const [, role, name] = roleMatch;
                return name
                    ? this.page.getByRole(role as any, { name })
                    : this.page.getByRole(role as any);
            }
        }

        // ── 3. Explicit text= prefix ──
        if (selector.startsWith('text=')) {
            return this.page.getByText(selector.slice(5));
        }

        // ── 4. Label prefix ──
        if (selector.startsWith('label=')) {
            return this.page.getByLabel(selector.slice(6));
        }

        // ── 5. Placeholder prefix ──
        if (selector.startsWith('placeholder=')) {
            return this.page.getByPlaceholder(selector.slice(12));
        }

        // ── 6. CSS selector (contains typical CSS characters) ──
        if (/[#.\[\]>:=@]/.test(selector)) {
            return this.page.locator(selector);
        }

        // ── 7. Plain text fallback ──
        return this.page.getByText(selector, { exact: false });
    }
}
