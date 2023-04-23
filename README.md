# deno-discord-gpt

ChatGPT Discord bot for personal use. Looks something like this:
```java
someUser: @gpt why is the sky blue?

gpt: @someUser The sky appears blue due to a process called Rayleigh scattering [...]
```

Built as an excuse to try Deno/Deploy. Ran into some concurrency issues, so I added Redis for at-most-once message handling, and as a bonus, chat history persistence.

### Infra
- [Deno Deploy](https://deno.com/deploy). Free tier
- [Upstash](https://upstash.com) (redis). Free tier
- [Freshping](https://www.freshworks.com/website-monitoring) to keep warm. Free tier
