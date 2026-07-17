import type { LLMProvider } from './provider.js';
import { GeminiProvider } from './gemini/provider.js';
import { OpenAIProvider } from './openai/provider.js';

class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  get(name: string): LLMProvider | null {
    return this.providers.get(name) || null;
  }

  require(name: string): LLMProvider {
    const provider = this.get(name);
    if (!provider) throw new Error(`不支持的 AI Provider：${name}`);
    return provider;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}

export const providerRegistry = new ProviderRegistry()
  .register(GeminiProvider)
  .register(OpenAIProvider);
export { ProviderRegistry };
