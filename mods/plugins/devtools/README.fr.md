# DevTools

Ouvre et referme les vrais outils de développement de Chrome dans Slack — console, éléments, réseau — depuis un bouton au-dessus de celui de BetterSlack. La même action que l'entrée de menu cachée ⌘⌥I de Slack.

- Un bouton à côté de celui de BetterSlack, qui ouvre les vrais outils de développement de Chrome — console, éléments, réseau.
- Il appelle la méthode de préchargement de Slack, celle qui se cache derrière l’entrée de menu ⌘⌥I, donc rien n’est patché ni injecté pour cela.
- Slack n’agit que sur une fenêtre au premier plan : le bouton ne fait rien si Slack est en arrière-plan.
