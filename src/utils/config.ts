import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export type LLMProviderType = 'glm' | 'openai' | 'claude';

export interface Config {
    llmProvider: LLMProviderType;
    glmApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    maxIterations: number;
    userDataDir: string;
}

export function loadConfig(): Config {
    const provider = (process.env.LLM_PROVIDER || 'glm') as LLMProviderType;

    const config: Config = {
        llmProvider: provider,
        glmApiKey: process.env.GLM_API_KEY || '',
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        maxIterations: parseInt(process.env.MAX_ITERATIONS || '50', 10),
        userDataDir: path.resolve(process.cwd(), 'user_data'),
    };

    // Validate required keys
    if (provider === 'glm' && !config.glmApiKey) {
        throw new Error('GLM_API_KEY is required when LLM_PROVIDER=glm');
    }
    if (provider === 'openai' && !config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
    }
    if (provider === 'claude' && !config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude');
    }

    return config;
}
