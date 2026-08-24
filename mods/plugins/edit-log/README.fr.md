# Edit Log

Garde ce qu'un message disait avant d'être modifié ou supprimé, et laisse un message supprimé à sa place au lieu de le voir disparaître.

- Un message supprimé reste là où il était, barré et signalé, avec une croix pour l'écarter. Slack, lui, le retire et laisse un trou qu'on ne remarque pas forcément.
- La formulation précédente d'un message modifié est conservée : « (modifié) » cesse d'être la fin de l'histoire.
- Le journal est une fenêtre sur le bouton de l'en-tête de canal, ou `⌘K` → **Journal des éditions** : qui, où, quand, et ce qui a changé, du plus récent au plus ancien. Une pastille sur le bouton compte ce qui est arrivé depuis votre dernier passage.
- Tout reste sur cette machine, dans le fichier de réglages de BetterSlack. Rien n'est envoyé à Slack ni ailleurs, et la fenêtre permet de tout effacer.

## Ce qu'il peut voir, et ce qu'il ne peut pas

**Il ne connaît que ce que votre client a affiché.** Il n'y a pas d'historique côté serveur derrière tout ça, et il ne fait aucune requête : il lit les messages à l'écran toutes les secondes et demie et les compare à ce qu'ils disaient la fois d'avant. Un message modifié ou supprimé pendant que vous étiez dans un autre canal n'est jamais passé par votre écran, et n'est pas dans le journal.

Distinguer un vrai changement d'un simple re-rendu de Slack est tout le travail, et trois règles s'en chargent :

- **Un message n'est pas comparable la première fois qu'on le voit.** D'autres mods réécrivent le texte — Full Links remplace le libellé tronqué d'un lien par l'URL entière juste après l'affichage — donc le texte doit être lu deux fois à l'identique avant qu'une différence ultérieure compte comme une modification.
- **Une suppression n'est retenue que si les messages de part et d'autre sont toujours à l'écran.** La liste de Slack est virtuelle : treize messages sur des milliers sont dans le document, et défiler en retire à une extrémité. Ça, c'est un trou avec un voisin manquant ; une suppression, c'est un trou avec les deux.
- **Et seulement après deux passages.** Slack re-rend en permanence, et un message peut quitter le document et revenir dans la même seconde.

**Il s'efface devant Demo Mode.** Tant que Demo Mode est actif, chaque nom et chaque message à l'écran sont inventés ; lire à ce moment-là remplirait le journal de mots que personne n'a écrits. Rien n'est enregistré jusqu'à ce qu'il soit désactivé.

## Réglages

| | |
| --- | --- |
| **Laisser les messages supprimés à l'écran** | La ligne barrée là où était le message. Désactivé, le journal les enregistre quand même, en silence. |
| **Enregistrer les suppressions autant que les modifications** | Désactivé, seules les modifications sont gardées. |
| **Entrées conservées** | Le plafond. Le journal vit dans le fichier de réglages que le chargeur lit à chaque démarrage, il n'a donc pas le droit de grossir sans fin. |

## Il conserve les mots des autres

C'est sa raison d'être, et autant le dire franchement plutôt que de l'enfouir. Le journal garde du texte que quelqu'un a choisi de reprendre. Il ne quitte jamais votre machine, la fenêtre l'efface, et désactiver le mod l'arrête — mais ce que vous en faites vous regarde, pas le mod.
