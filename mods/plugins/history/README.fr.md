# History

Tout ce que Slack change sans jamais le dire — modifications, suppressions, réactions retirées, renommages, statuts, arrivées et départs — sur une page que l'on peut chercher et trier.

Un onglet dans le rail de Slack, sous Accueil et Activité, ou `⌘⇧H`, ou `⌘K` → **Historique**. Une pastille dessus compte ce qui est arrivé depuis votre dernier passage. C'est une vue comme celles de Slack : elle prend tout le panneau, liste des canaux comprise, et on la quitte en allant ailleurs. La conversation où vous étiez est masquée et non recouverte : un message qui y arrive pendant que vous lisez votre historique reste non lu.

## Ce qu'il garde

| | |
| --- | --- |
| **Messages** | Un message réécrit, avec les deux formulations. Un message supprimé, avec ce qu'il disait — et le message laissé là où il était, barré, avec le nom et le visage de celui à qui il était, au lieu du trou qui se referme dessus. L'endroit est recalculé à partir des horodatages de ce qui est à l'écran à chaque affichage, donc la ligne tombe au bon endroit même quand la conversation a avancé. |
| **Réactions** | Une réaction ajoutée ou retirée, avec l'émoji et la personne qui l'a faite. |
| **Noms** | Un canal renommé, une section de sidebar renommée, quelqu'un qui change de nom d'affichage. Slack ne dit rien des trois. Une section est reconnue par l'identifiant que Slack lui donne, donc réordonner la sidebar — ou changer d'espace de travail — n'est pas un renommage. |
| **Personnes** | Quelqu'un qui rejoint ou quitte une conversation, et les statuts au fil de leurs changements. |

Chaque carte peut être oubliée séparément, à côté du bouton qui vide tout. La page a une recherche qui porte sur tout ce qu'une ligne affiche — un nom se retrouve qu'il ait été la personne, le canal ou le mot changé —, des filtres par famille et cinq tris. Chaque ligne propose de copier l'ancien texte, et d'aller au message quand il en reste un.

## Ce qu'il peut voir, et ce qu'il ne peut pas

**Il écoute la socket de Slack, et fonctionne dans les conversations que vous n'ouvrez jamais.** Slack tient une socket par espace de travail et y pousse tout ce qui se passe dans chaque conversation dont vous êtes membre — un message, une modification, une suppression, une réaction, un nom ou un statut qui change, quelqu'un qui rejoint — que la conversation soit ouverte ou non. C'est comme ça que les pastilles de non-lus bougent sans que vous regardiez. C'est de là que vient presque tout ce qui suit, et c'est pourquoi un message modifié dans un canal que vous n'avez pas ouvert depuis un mois est dans cette liste.

**Rien n'est marqué comme lu par tout ça.** Slack marque une conversation lue quand son client envoie `conversations.mark` ; être prévenu qu'un message existe n'envoie rien du tout. Surveiller toutes les conversations laisse chaque non-lu exactement où il était — c'est toute la différence avec l'autre solution évidente, ouvrir les conversations pour les regarder.

**Il lit aussi l'écran, et interroge Slack une fois par canal ouvert.** L'écran attrape un changement au moment où il se produit, seconde par seconde. Ouvrir un canal demande en plus à `conversations.history` ses soixante derniers messages et les compare à ce que le canal était quand vous l'avez quitté — une modification, une suppression ou une réaction retirée pendant que vous étiez ailleurs est donc rattrapée dès votre retour. La première visite d'un canal sert de référence et ne produit jamais d'événement, et un message plus ancien que cette page est hors de la fenêtre, pas supprimé.

C'est aussi le seul endroit où **qui** a réagi peut être su : Slack y donne les identifiants, alors qu'à l'écran il ne le dit que dans une infobulle construite au survol, dans la langue du lecteur et avec des noms.

Distinguer un vrai changement d'un re-rendu de Slack est tout le travail, et trois règles s'en chargent :

- **Rien n'est comparable à la première lecture.** D'autres mods réécrivent ce qui est à l'écran — Full Links remplace le libellé tronqué d'un lien par l'URL entière juste après l'affichage — donc une lecture doit se répéter à l'identique avant qu'une différence ultérieure compte.
- **Une suppression est un trou dont les deux voisins sont encore là.** La liste de Slack est virtuelle : treize messages sur des milliers sont dans le document, et défiler en retire à une extrémité. Ça, c'est un trou avec un voisin manquant ; une suppression, c'est un trou avec les deux. La seule exception est le message qu'on vient d'écrire, tout en bas, sans rien après lui : il compte tant que rien n'est arrivé derrière.
- **Qui sont les voisins vient de leurs horodatages**, pas de l'ordre dans lequel le document les tient. La liste étant virtuelle, un nœud peut se retrouver de l'autre côté de ses propres voisins le temps d'une image pendant que Slack reconstruit la fenêtre, et un ordre cru une fois est mémorisé tant que le canal reste ouvert.
- **Et seulement après deux passages**, parce que Slack re-rend en permanence et qu'un message peut quitter le document et revenir dans la même seconde.

**Ce qu'une application fait à ses propres messages n'est pas conservé.** Un statut de déploiement qui avance, une alerte qui se résout, un bot qui réécrit six fois la même ligne : chacun est une modification, et aucun n'est quelqu'un qui reprend quelque chose. Ils arrivent aussi bien plus vite que tout ce que fait une personne, donc un journal qui les garde est un journal où plus rien d'autre n'est visible. Uniquement les changements de l'application sur ses *propres* messages — une personne qui réagit à une alerte reste une personne, et l'arrivée du message n'a jamais été un événement ici. **Garder ce que les applications changent dans leurs propres messages** le réactive.

**Une réaction est nommée, ou elle n'est pas enregistrée.** Lire l'écran permet de voir un compte bouger et rien de plus — Slack ne dit qui a réagi que dans une infobulle construite au survol, dans la langue du lecteur et avec des noms plutôt que des identifiants. Un compte qui bouge n'est donc pas écrit : c'est ce qui envoie interroger `conversations.history`, qui donne les identifiants, et la ligne est écrite à partir de cette réponse, avec la personne dessus. « Quelqu'un a retiré une réaction » répond par un haussement d'épaules à la seule question que la ligne pose, et un historique incapable de dire qui ne sert à rien comme historique.

Le seul cas qui ne laisse rien est une réaction portée par un très grand nombre de gens, où Slack tronque la liste des identifiants et où seul le compte a bougé. C'est une réaction toujours posée sur le message pour qui veut la compter, donc le silence est la meilleure moitié de l'échange.

**Un message est affiché comme Slack l'affiche.** Ce que répond `conversations.history` n'est pas ce que Slack montre : une mention arrive en `<@U04ED8UPV>`, un lien en `<https://…|https://…>`, une esperluette en `&amp;`, et l'emphase sous forme des astérisques que quelqu'un a tapés. Laissé tel quel, un journal de messages est un journal de format réseau. Le rendu est celui du runtime — la palette de commandes dessine ses résultats de recherche avec le même — donc une mention est un nom, un canal est un nom sur lequel on peut cliquer, et un lien est son libellé.

**Et la ligne laissée dans la conversation porte le balisage de message de Slack.** Pas par commodité : un thème habille le client à travers ces noms de classes, donc tout ce qui est dessiné dans une conversation avec un balisage à soi est la seule chose à l'écran qu'un thème ne peut pas atteindre. Discord arrondit chaque avatar via `.c-message_kit__avatar img`, et un visage carré dans une colonne de ronds se lit comme cassé plutôt que comme un mod. Le `data-qa` de Slack n'est délibérément pas copié — c'est ce sur quoi chaque mod d'ici reconnaît un message, celui-ci compris.

**Les émoji sont dessinés, pas épelés.** Un shortcode ne se transforme pas en image à partir de son nom : Slack sert un émoji standard par point de code, donc `slightly_smiling_face` ne construit aucune URL, et `emoji.list` ne répond qu'avec les émoji personnalisés de l'espace de travail. L'écran de Slack est la table que personne ne publie — chaque émoji qu'il dessine est une image portant son nom — donc les paires sont collectées à mesure que vous utilisez Slack, et conservées. Un émoji vu une fois est un émoji que ceci sait dessiner pour toujours, dans le texte d'un message comme sur une réaction.

La table se remplit d'elle-même : un émoji jamais vu dans ce client s'affiche en shortcode la première fois, et en lui-même ensuite. Sur une ligne de réaction, où l'émoji est tout le contenu, celui qui ne peut pas être dessiné est omis plutôt qu'épelé, et le nom passe dans l'infobulle.

**Une arrivée est une différence entre deux listes de membres**, pas un avis analysé dans une phrase. Slack affiche bien « X a rejoint », puis le replie et finit par ne plus le montrer — et la formulation dépend de la langue du lecteur.

**Un nom d'affichage vient de `users.info`, pas de l'écran.** Mesuré dans un vrai client : `[data-qa="message_sender"]` contient le nom en double sur certains messages — « Ada LovelaceAda Lovelace : » — et une seule fois sur d'autres, donc comparer ce qui est affiché signale un renommage toutes les quelques secondes de la part de quelqu'un qui n'a rien changé. Ce que le client de Slack croit que quelqu'un s'appelle est ce qui change vraiment.

**Il s'efface devant Demo Mode.** Tant que Demo Mode est actif, chaque nom et chaque message à l'écran sont inventés ; lire à ce moment-là remplirait le journal de mots que personne n'a écrits. Rien n'est enregistré jusqu'à ce qu'il soit désactivé, et Demo Mode balaie les propres nœuds de ce mod, pour qu'une vraie phrase ne parte pas dans une capture d'écran à l'intérieur d'une ligne barrée.

## Les requêtes, et où vit le journal

Le journal est dans `~/.betterslack/settings.json` sous ce plugin, plafonné par un réglage, et la page permet de tout effacer. Rien n'est envoyé à Slack ni ailleurs.

Les requêtes qu'il fait sont celles qu'il ne peut pas éviter : une page d'historique par canal ouvert, la liste des membres du canal ouvert, et les statuts des personnes vues — les deux dernières toutes les cinq minutes et toutes deux désactivables. Transformer un identifiant en nom passe par `api.slack.web`, mis en cache par espace de travail.

## Réglages

| | |
| --- | --- |
| **Garder ce que les applications changent dans leurs propres messages** | Désactivé par défaut : une application qui réécrit ou supprime son propre message n'est pas quelqu'un qui reprend quelque chose. |
| **Laisser les messages supprimés à l'écran** | La ligne barrée là où était le message. Désactivé, il est quand même enregistré, en silence. |
| **Suivre les statuts et qui est dans un canal** | La seule partie qui fait des requêtes. Désactivée, tout le reste continue. |
| **Entrées conservées** | Le plafond. Le journal vit dans le fichier de réglages que le chargeur lit à chaque démarrage, il n'a donc pas le droit de grossir sans fin. |
| **Raccourci** | Ouvre et ferme la page. `mod+shift+h` par défaut. |

## Il conserve les mots des autres

C'est sa raison d'être, et autant le dire franchement plutôt que de l'enfouir. Le journal garde du texte et des noms que quelqu'un a choisi de changer ou de reprendre. Il ne quitte jamais votre machine, la page l'efface, et désactiver le mod l'arrête — mais ce que vous en faites vous regarde, pas le mod.
