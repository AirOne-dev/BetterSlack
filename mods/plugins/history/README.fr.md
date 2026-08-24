# History

Tout ce que Slack change sans jamais le dire — modifications, suppressions, réactions retirées, renommages, statuts, arrivées et départs — sur une page que l'on peut chercher et trier.

Un onglet dans le rail de Slack, sous Accueil et Activité, ou `⌘⇧H`, ou `⌘K` → **Historique**. Une pastille dessus compte ce qui est arrivé depuis votre dernier passage. C'est une vue comme celles de Slack : elle prend tout le panneau, liste des canaux comprise, et on la quitte en allant ailleurs. La conversation où vous étiez est masquée et non recouverte : un message qui y arrive pendant que vous lisez votre historique reste non lu.

## Ce qu'il garde

| | |
| --- | --- |
| **Messages** | Un message réécrit, avec les deux formulations. Un message supprimé, avec ce qu'il disait — et le message laissé là où il était, barré, au lieu du trou qui se referme dessus. |
| **Réactions** | Une réaction ajoutée ou retirée, avec l'émoji et le compte avant et après. |
| **Noms** | Un canal renommé, une section de sidebar renommée, quelqu'un qui change de nom d'affichage. Slack ne dit rien des trois. |
| **Personnes** | Quelqu'un qui rejoint ou quitte une conversation, et les statuts au fil de leurs changements. |

La page a une recherche qui porte sur tout ce qu'une ligne affiche — un nom se retrouve qu'il ait été la personne, le canal ou le mot changé —, des filtres par famille et cinq tris. Chaque ligne propose de copier l'ancien texte, et d'aller au message quand il en reste un.

## Ce qu'il peut voir, et ce qu'il ne peut pas

**Il ne connaît que ce que votre client a affiché.** Il n'y a pas d'historique côté serveur derrière tout ça. Il lit l'écran toutes les secondes et demie et le compare à ce qu'il a lu la fois d'avant : ce qui a changé pendant que vous étiez dans un autre canal n'est jamais passé par votre écran, et n'est pas là.

Distinguer un vrai changement d'un re-rendu de Slack est tout le travail, et trois règles s'en chargent :

- **Rien n'est comparable à la première lecture.** D'autres mods réécrivent ce qui est à l'écran — Full Links remplace le libellé tronqué d'un lien par l'URL entière juste après l'affichage — donc une lecture doit se répéter à l'identique avant qu'une différence ultérieure compte.
- **Une suppression est un trou dont les deux voisins sont encore là.** La liste de Slack est virtuelle : treize messages sur des milliers sont dans le document, et défiler en retire à une extrémité. Ça, c'est un trou avec un voisin manquant ; une suppression, c'est un trou avec les deux.
- **Et seulement après deux passages**, parce que Slack re-rend en permanence et qu'un message peut quitter le document et revenir dans la même seconde.

**Il ne prétend pas savoir qui a réagi.** Slack ne le dit que dans une infobulle construite au survol, dans la langue du lecteur et avec des noms plutôt que des identifiants. L'émoji et le compte sont ce qui peut être su honnêtement, donc c'est ce qui est enregistré.

**Une arrivée est une différence entre deux listes de membres**, pas un avis analysé dans une phrase. Slack affiche bien « X a rejoint », puis le replie et finit par ne plus le montrer — et la formulation dépend de la langue du lecteur.

**Un nom d'affichage vient de `users.info`, pas de l'écran.** Mesuré dans un vrai client : `[data-qa="message_sender"]` contient le nom en double sur certains messages — « Ada LovelaceAda Lovelace : » — et une seule fois sur d'autres, donc comparer ce qui est affiché signale un renommage toutes les quelques secondes de la part de quelqu'un qui n'a rien changé. Ce que le client de Slack croit que quelqu'un s'appelle est ce qui change vraiment.

**Il s'efface devant Demo Mode.** Tant que Demo Mode est actif, chaque nom et chaque message à l'écran sont inventés ; lire à ce moment-là remplirait le journal de mots que personne n'a écrits. Rien n'est enregistré jusqu'à ce qu'il soit désactivé, et Demo Mode balaie les propres nœuds de ce mod, pour qu'une vraie phrase ne parte pas dans une capture d'écran à l'intérieur d'une ligne barrée.

## Les requêtes, et où vit le journal

Le journal est dans `~/.betterslack/settings.json` sous ce plugin, plafonné par un réglage, et la page permet de tout effacer. Rien n'est envoyé à Slack ni ailleurs.

Les seules requêtes qu'il fait sont celles qu'il ne peut pas éviter : la liste des membres du canal ouvert, et les statuts des personnes vues, toutes les cinq minutes et toutes deux désactivables. Transformer un identifiant en nom passe par `api.slack.web`, mis en cache par espace de travail.

## Réglages

| | |
| --- | --- |
| **Laisser les messages supprimés à l'écran** | La ligne barrée là où était le message. Désactivé, il est quand même enregistré, en silence. |
| **Suivre les statuts et qui est dans un canal** | La seule partie qui fait des requêtes. Désactivée, tout le reste continue. |
| **Entrées conservées** | Le plafond. Le journal vit dans le fichier de réglages que le chargeur lit à chaque démarrage, il n'a donc pas le droit de grossir sans fin. |
| **Raccourci** | Ouvre et ferme la page. `mod+shift+h` par défaut. |

## Il conserve les mots des autres

C'est sa raison d'être, et autant le dire franchement plutôt que de l'enfouir. Le journal garde du texte et des noms que quelqu'un a choisi de changer ou de reprendre. Il ne quitte jamais votre machine, la page l'efface, et désactiver le mod l'arrête — mais ce que vous en faites vous regarde, pas le mod.
