# AnthropicPromptCachingStrategy

`AnthropicPromptCachingStrategy` applies Anthropic-specific cache metadata after the prompt has already been assembled.

It does not decide reminder content or reminder placement. Use it when your prompt already has a naturally stable shared prefix, such as an unchanged system prompt or preserved leading conversation history.
