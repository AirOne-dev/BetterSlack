# Code Highlight

Colours the code blocks in messages, and works out which language they are on its own -- Slack sends them as plain grey text with no way to say what they contain. Twenty-one languages, from JSON and SQL to GraphQL, Dockerfiles and diffs, and it leaves a block alone when it is not sure.

- Slack sends a code block as plain grey text with nothing to say what is in it, so the language is worked out from the code itself.
- Twenty-one languages: JavaScript, TypeScript, Python, Go, Rust, Java, C, C++, C#, PHP, Ruby, Swift, Kotlin, SQL, GraphQL, JSON, YAML, HTML, CSS, shell, Dockerfiles and diffs.
- When the guess is not confident it leaves the block alone — grey code is better than code coloured as the wrong language.
- The lexer is written by hand: Slack’s content policy forbids eval, so no off-the-shelf highlighter can run in the page.
