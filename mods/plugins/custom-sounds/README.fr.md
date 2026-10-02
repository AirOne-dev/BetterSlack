# Sons personnalisés

Utilisez vos propres fichiers audio pour les notifications de Slack.

Ouvrez **Préférences → Notifications**. Chaque liste de sons propose, sous les sons de Slack :

- **vos sons**, ceux que vous avez ajoutés ;
- **Ajouter un son…**, qui ouvre un sélecteur de fichiers (mp3, wav, ogg, m4a, flac…, jusqu'à 5 Mo) ;
- **Gérer vos sons…**, pour les écouter, les renommer ou les supprimer.

Cela vaut pour chaque liste de la page : messages, messages des VIP, envoi d'un message, réception d'un message pendant que vous êtes dans la conversation, appels d'équipe et notifications de calendrier. Le gestionnaire est aussi dans la palette de commandes, sous *Gérer les sons personnalisés*.

## Supprimer un son

La suppression demande une confirmation. Chaque liste qui utilisait ce son reprend ensuite celui qu'elle avait avant que vous le choisissiez. Rien ne devient muet par accident : si le choix précédent était « aucun son », c'est à lui qu'elle revient.

## Où vont les fichiers

Vos fichiers restent sur cet ordinateur, dans `~/.betterslack/data/custom-sounds/`. Rien n'est envoyé, et Slack ne voit jamais le fichier.

## Comment ça marche

Au moment de jouer un son, Slack dit seulement quel fichier il joue, jamais pour quoi. Chaque son personnalisé s'appuie donc sur un des sons de Slack, son *porteur* :

- Le réglage de la liste, dans Slack, est mis sur ce porteur.
- Quand Slack joue le porteur, c'est votre fichier qui part à la place, au même volume et sur la même sortie audio.

Dès que possible, le porteur est le son que vous aviez avant. Ainsi :

- Slack, sur un autre ordinateur sans BetterSlack, continue de jouer votre son précédent.
- Désactiver ce plugin le fait revenir immédiatement.

Sur Mac, Slack confie normalement les sons de notification à macOS, qui ne sait jouer que les sons livrés avec Slack. Tant qu'une notification utilise un de vos sons, le plugin demande donc à Slack de jouer lui-même les sons de notification, ce qui est le réglage par défaut de Slack. Il le fait à chaque démarrage, car Slack revient en arrière à chaque lancement. Quand plus aucune notification n'utilise un de vos sons, ou quand le plugin est désactivé, l'ancien réglage revient.

Votre choix est écrit à travers la liste de Slack elle-même, comme vous le feriez. C'est pourquoi le choix se fait dans les Préférences. Si un son supprimé a besoin de la liste de Slack pour revenir en arrière alors que les Préférences sont fermées, le retour s'applique à leur prochaine ouverture.

Nécessite BetterSlack 3.4.0 ou plus récent : les fichiers sont conservés avec `api.data`.
