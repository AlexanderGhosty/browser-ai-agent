import { chromium, type BrowserContext, type Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * Manages the Playwright browser lifecycle.
 * Uses a persistent context so user logins survive across sessions.
 */
export class BrowserManager {
    private context: BrowserContext | null = null;
    private userDataDir: string;

    constructor(userDataDir: string) {
        this.userDataDir = userDataDir;
    }

    /**
     * Launch Chromium in headed mode with a persistent profile.
     */
    async launch(): Promise<void> {
        logger.system('Launching browser (persistent session)...');

        this.context = await chromium.launchPersistentContext(this.userDataDir, {
            headless: false,
            viewport: { width: 1280, height: 900 },
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-default-browser-check',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        // If no pages are open, create one
        if (this.context.pages().length === 0) {
            await this.context.newPage();
        }

        logger.system('Browser launched successfully');
    }

    /**
     * Get the currently active page (last focused/created page).
     * Filters out closed pages to prevent "Target page has been closed" errors.
     */
    getActivePage(): Page {
        if (!this.context) {
            throw new Error('Browser not launched');
        }

        const pages = this.context.pages().filter(p => !p.isClosed());
        if (pages.length === 0) {
            throw new Error('No pages open in browser');
        }

        // Return the last page (most recently created/focused)
        return pages[pages.length - 1];
    }

    /**
     * Close all tabs except the most recent (active) one.
     * Prevents tab accumulation from links that open in new tabs.
     */
    async closeExtraTabs(): Promise<void> {
        if (!this.context) return;

        const pages = this.context.pages().filter(p => !p.isClosed());
        if (pages.length <= 1) return;

        // Keep only the last page (most recently created/focused)
        const activePage = pages[pages.length - 1];
        for (const page of pages) {
            if (page !== activePage) {
                try {
                    await page.close();
                } catch { /* already closed */ }
            }
        }
    }

    /**
     * Get the browser context.
     */
    getContext(): BrowserContext {
        if (!this.context) {
            throw new Error('Browser not launched');
        }
        return this.context;
    }

    /**
     * Gracefully close the browser.
     */
    async close(): Promise<void> {
        if (this.context) {
            logger.system('Closing browser...');
            await this.context.close();
            this.context = null;
        }
    }
}
