import readline from 'readline';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { BrowserManager } from './browser/manager.js';
import { BrowserAgent } from './agent/agent.js';
import { createLLMProvider } from './llm/provider.js';

/**
 * Create a readline interface for terminal interaction.
 */
function createReadline(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Prompt the user for input in the terminal.
 */
function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Main entry point.
 */
async function main() {
    logger.banner();

    // Load configuration
    let config;
    try {
        config = loadConfig();
    } catch (error) {
        logger.error(`Configuration error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }

    // Create LLM provider
    const llm = createLLMProvider(config);
    logger.system(`LLM Provider: ${llm.name} (${llm.model})`);

    // Launch browser
    const browserManager = new BrowserManager(config.userDataDir);
    try {
        await browserManager.launch();
    } catch (error) {
        logger.error(`Failed to launch browser: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }

    logger.system('🌐 Browser launched (persistent session)');
    logger.separator();

    // Create readline for user interaction
    const rl = createReadline();

    /**
     * Callback for when the agent needs user input (ask_user tool or security confirmation).
     */
    const askUserCallback = async (question: string): Promise<string> => {
        return askQuestion(rl, `\n${question}\n> `);
    };

    // Get the active page
    const page = browserManager.getActivePage();

    // Create the agent
    const agent = new BrowserAgent(page, {
        llm,
        maxIterations: config.maxIterations,
        askUserCallback,
    });

    // Main interaction loop
    console.log();

    while (true) {
        const task = await askQuestion(rl, '💬 Enter your task (or "quit" to exit):\n> ');

        if (!task || task.toLowerCase() === 'quit' || task.toLowerCase() === 'exit') {
            break;
        }

        logger.separator();

        try {
            // Update the page reference in case tabs changed
            const currentPage = browserManager.getActivePage();
            agent.setPage(currentPage);

            // Run the agent
            const result = await agent.run(task);

            logger.separator();
            console.log();
            logger.done(`Task result: ${result}`);
            console.log();
        } catch (error) {
            logger.error(`Agent error: ${error instanceof Error ? error.message : error}`);
        }
    }

    // Cleanup
    logger.system('Shutting down...');
    rl.close();
    await browserManager.close();
    logger.system('Goodbye! 👋');
    process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n');
    logger.system('Received SIGINT, shutting down...');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    logger.error(`Unhandled rejection: ${error}`);
});

// Start
main().catch((error) => {
    logger.error(`Fatal error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
