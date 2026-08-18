# Code Highlight

Colore les blocs de code des messages et devine tout seul de quel langage il s'agit — Slack les envoie en gris, sans aucun moyen de dire ce qu'ils contiennent. Vingt et un langages, de JSON et SQL à GraphQL, aux Dockerfile et aux diffs, et il laisse un bloc tranquille quand il n'est sûr de rien.

- Slack envoie un bloc de code en gris, sans rien qui dise ce qu’il contient : le langage est donc déduit du code lui-même.
- Vingt et un langages : JavaScript, TypeScript, Python, Go, Rust, Java, C, C++, C#, PHP, Ruby, Swift, Kotlin, SQL, GraphQL, JSON, YAML, HTML, CSS, shell, Dockerfile et diffs.
- Quand la détection n’est pas sûre, le bloc reste tel quel : du code gris vaut mieux que du code colorié dans le mauvais langage.
- L’analyseur est écrit à la main : la politique de contenu de Slack interdit eval, donc aucun coloriseur du commerce ne peut tourner dans la page.
