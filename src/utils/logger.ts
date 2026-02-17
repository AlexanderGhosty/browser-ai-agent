import chalk from 'chalk';

export const logger = {
    observe(message: string) {
        console.log(chalk.cyan(`🔍 [OBSERVE] ${message}`));
    },

    think(message: string) {
        console.log(chalk.yellow(`🧠 [THINK]  ${message}`));
    },

    act(message: string) {
        console.log(chalk.green(`🎯 [ACT]    ${message}`));
    },

    security(message: string) {
        console.log(chalk.red(`⚠️  [SECURITY] ${message}`));
    },

    user(message: string) {
        console.log(chalk.blue(`💬 [USER]   ${message}`));
    },

    done(message: string) {
        console.log(chalk.magenta(`✅ [DONE]   ${message}`));
    },

    error(message: string) {
        console.log(chalk.redBright(`❌ [ERROR]  ${message}`));
    },

    system(message: string) {
        console.log(chalk.gray(`⚙️  [SYSTEM] ${message}`));
    },

    toolResult(tool: string, result: string) {
        const truncated = result.length > 200 ? result.slice(0, 200) + '...' : result;
        console.log(chalk.greenBright(`   ↳ ${tool} → ${truncated}`));
    },

    separator() {
        console.log(chalk.gray('━'.repeat(60)));
    },

    banner() {
        console.log(chalk.bold.cyan('\n🤖 AI Browser Agent'));
        console.log(chalk.gray('   Autonomous browser automation powered by AI\n'));
        logger.separator();
    },
};
