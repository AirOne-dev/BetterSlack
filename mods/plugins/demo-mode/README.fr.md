# Demo Mode

Ajoute un interrupteur dans la barre du haut qui remplit votre vrai Slack de gens qui n'existent pas : chaque nom, visage, message, canal, fichier et lien à l'écran est remplacé par un inventé, pour que vous puissiez capturer, partager votre écran ou faire une démo sans montrer le travail de personne. Une seconde pression et le vrai revient. Il démarre éteint, et le reste tant que vous ne demandez rien.

- **L'interrupteur est à l'extrémité droite de la barre du haut**, à côté des contrôles de Slack, et il devient rouge tant que la démo tourne. Installer le mod n'est pas la demande ; appuyer sur l'interrupteur, oui.
- **Un appareil photo apparaît à côté pendant une démo.** Il dessine la fenêtre à la taille qu'utilisent le site et les readmes, la photographie, et dépose un WebP dans vos téléchargements — avec un éclair, pour que ça se voie. C'est Chromium qui l'encode : le fichier fait le double de résolution d'un JPEG pour environ la moitié du poids, et rien n'est à convertir ensuite. L'interrupteur, l'appareil et le bandeau de BetterSlack sortent du champ d'abord : l'image est celle de Slack, pas celle de l'appareil.
- **L'état n'est volontairement pas mémorisé.** Chaque démarrage est éteint. Revenir sur un Slack plein de noms inventés après un redémarrage, et les lire comme vrais, est la seule panne que ce mod pourrait provoquer à lui seul.
- Il **remplace** au lieu de flouter. Un nom flouté reste un nom qui était à l'écran, et un rectangle noir annonce que l'image avait quelque chose à cacher ; la substitution donne un écran qui ressemble à Slack en usage et ne contient personne.
- Chaque remplacement dérive d'un hash de l'original : la même personne est le même personnage inventé dans la barre latérale, dans les messages et dans la liste des membres — et deux passages donnent le même écran.
- **Un bandeau rouge reste affiché en bas en permanence.** Oublier dans quel état on est, c'est le vrai risque : une capture qu'on croit anonyme, ou un nom qu'on croyait inventé.
- L'éteindre remet tout en place, et seulement là où Slack n'a pas redessiné depuis — réécrire un ancien message par-dessus un plus récent serait une autre forme d'erreur.
- « Vérifier l'écran », depuis la palette de commandes, liste ce qui est encore réel. C'est une règle absolue plutôt qu'une mémoire : après un balayage, rien de dessiné ne doit pointer ailleurs que vers example.com.
- La zone de saisie est balayée une fois, au démarrage, puis laissée tranquille. La réécrire à chaque frappe rendrait le client inutilisable ; ce que vous tapez pendant une démo, ce sont vos propres mots, sur votre propre écran.
- Les blocs de code deviennent du code, pas de la prose : une capture d'un coloriseur syntaxique montre donc toujours de la syntaxe.
- C'est le même moteur que celui que `pnpm shoot --mods` exécute avant de photographier un vrai espace de travail : les images de ce dépôt et les vôtres cachent donc les mêmes choses.

Ce qu'il ne peut pas faire, c'est rendre une fuite impossible : le balayage est une liste des endroits où Slack met du contenu, et une liste peut toujours en rater un. C'est à cela que sert « Vérifier l'écran » — lisez-le avant d'appuyer sur le déclencheur.
