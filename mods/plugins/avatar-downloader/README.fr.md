# Avatar Downloader

Télécharge la photo de profil d'un membre dans la meilleure qualité que Slack conserve : l'original quand il existe, sinon le plus grand rendu. Ajoute un bouton dans le panneau de profil et dans les actions au survol d'un message.

- Un bouton « Télécharger la photo » dans le panneau de profil, et la même action dans les actions au survol d’un message.
- Il demande d’abord l’original à Slack et se rabat sur le plus grand rendu : vous obtenez le meilleur fichier existant, pas la vignette de 48 px affichée.
- Le téléchargement passe par le loader : le CDN de Slack n’envoie aucun en-tête CORS, la page ne peut donc pas le récupérer elle-même.
