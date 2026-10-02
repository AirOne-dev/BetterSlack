# Quelio

Une fine barre en haut de Slack qui montre où en est votre semaine par rapport à l’objectif Quelio, à quelle heure partir aujourd’hui, et où en est la pause déjeuner.

- **La barre** se place dans la barre du haut de Slack, à côté de la recherche : une fine jauge pour la semaine, une plus fine encore pour la journée, le total de la semaine et une ligne sur l’instant présent — *Encore 2h08 · départ 17:24*, *Pause · 32 min / 1h · reprise à 13:17*, *Départ possible*. Dans une fenêtre étroite, elle se raccourcit d’elle-même, jusqu’à la jauge seule.
- **Un clic** ouvre le détail : la semaine (effectué, objectif, restant), la journée (arrivée, ce que Quelio décompte jusqu’ici, pause déjeuner, reste à faire, départ conseillé et plage de départ autorisée) et chaque jour de la semaine.
- **Elle suit l’horloge.** Quelio est interrogé environ une fois par heure ; la durée de la pause et le reste à faire sont recalculés localement à partir de la dernière réponse, si bien que la barre n’a jamais une heure de retard.

## Mise en route

1. Installez puis activez Quelio depuis l’onglet Parcourir.
2. Cliquez sur **Quelio · Se connecter** dans la barre du haut. La première fois, l’**adresse du quelio-api** de votre entreprise est demandée — le serveur, terminé par une barre oblique, par exemple `https://example.com/quelio-api/`. Elle est gardée dans les réglages du plugin, où vous pouvez la modifier.
3. Connectez-vous avec votre identifiant et votre mot de passe Quelio.

Les réglages permettent aussi de choisir la fréquence d’actualisation (une heure au minimum) et ce qu’affiche la barre : progression et état du jour, progression et reste à faire, ou progression seule.

## Comment la suggestion est calculée

L’objectif hebdomadaire est celui de Quelio (`minutes_objective`, ou 38 heures s’il n’en fournit pas). Ce qui reste est réparti **à parts égales** sur les jours ouvrés restants de la semaine, à ceci près qu’aucun jour ne peut contenir plus qu’il ne peut — une journée va au plus de 08:30 à 18:30, jusqu’à 17:30 le vendredi, avec une heure de pause — et qu’un jour qui ne peut pas prendre sa part laisse le reste aux autres. Cette part est l’objectif du jour. Le départ conseillé est l’heure à laquelle vous l’atteignez, et **jamais avant 16:30** ni après l’heure maximale.

Si les heures restantes ne peuvent pas être faites même en restant aussi tard que permis chaque jour restant, le plugin le dit, avec ce qui manque, et propose de rester jusqu’à l’heure maximale — jamais une heure qui enfreint une règle.

Les règles que respecte chaque suggestion :

- **Arrivée** entre 08:30 et 09:00.
- **Pause déjeuner** commencée entre 12:00 et 13:00, terminée avant 14:00, d’une heure au moins.
- **Départ** pas avant 16:30, et au plus tard à 18:30 — 17:30 le vendredi.

La pause déjeuner est lue dans les badges : c’est la première sortie qui chevauche 12:00–14:00. Quelio n’en compte que la partie située dans cette plage, si bien qu’une pause commencée à 11:50 atteint son heure à 13:00, et non à 12:50.

**Congés.** Un jour sans badge peut être marqué comme congé dans le détail. Il compte pour un cinquième de l’objectif hebdomadaire et ne demande aucune heure. Les demi-journées ne sont pas prises en charge.

## Ce qui est envoyé, et où

- **Un seul type de requête, vers une seule adresse** : un `POST` vers l’adresse du quelio-api indiquée dans les réglages, avec `action=login` et votre identifiant Quelio accompagné soit de votre mot de passe (une fois, pour la connexion), soit du jeton renvoyé par Quelio. Rien de Slack — aucun message, canal, espace de travail ni jeton Slack — n’est jamais envoyé.
- La requête est faite par le loader de BetterSlack via `api.net`, parce que quelio-api n’envoie pas d’en-têtes CORS et qu’une page dans Slack ne peut pas lire sa réponse. Le manifeste déclare le réglage d’adresse sous `network`, et le loader refuse toute autre adresse, le http non chiffré et les redirections.
- Chaque actualisation fait se connecter Quelio à Kelio, c’est pourquoi quelio-api demande de ne pas dépasser un appel par heure. Un mot de passe refusé n’est jamais réessayé dans votre dos : cinq échecs en cinq minutes bloquent tout votre réseau pendant un moment.

## Ce qui est conservé, et comment

- **Le mot de passe n’est jamais enregistré.** Il quitte le formulaire dès que vous appuyez sur Se connecter, et n’est envoyé qu’une fois.
- **Le jeton de session et les heures de la semaine sont gardés dans le dossier de données du plugin** (`~/.betterslack/data/quelio/`, via `api.data`), pour qu’un redémarrage ne demande pas de se reconnecter. Ils ne sont volontairement pas dans le fichier de réglages de BetterSlack, qui est copié dans chaque sauvegarde de BetterSlack et dans le script par lequel démarre chaque page de Slack. Ce sont tout de même des fichiers en clair sur le disque : **ils ne sont pas chiffrés**, et quiconque peut les lire peut utiliser le jeton pour lire vos heures via quelio-api, jusqu’à ce que le jeton y soit invalidé.
- L’identifiant, pour le formulaire de connexion, et les jours marqués en congé sont dans le fichier de réglages, avec les autres réglages du plugin.
- **Se déconnecter** efface le jeton, les heures et l’identifiant sur cet ordinateur. Supprimer le plugin ne le fait pas : BetterSlack garde le dossier de données d’un plugin quand celui-ci s’en va, alors déconnectez-vous d’abord. quelio-api ne permet pas de révoquer un jeton à distance : il reste valide côté serveur jusqu’à ce que Quelio l’invalide, ce que fait un échec de connexion à Kelio ou un changement de mot de passe.
- Quand Quelio indique que la session est terminée, le plugin se déconnecte et propose de se reconnecter ; il ne réessaie jamais avec un jeton qu’il sait expiré.

## Limites

- Les règles ci-dessus sont fixes, dans `lib/rules.js`, tout comme la façon de compter de Quelio (les valeurs par défaut du `config.example.php` de quelio-api). Si votre serveur compte autrement, le chiffre du jour suit malgré tout la réponse de Quelio ; seule la progression depuis cette réponse est calculée localement.
- L’heure est celle de l’horloge de votre ordinateur, qui est celle de la badgeuse pour qui se trouve dans le même fuseau horaire.
- Entre deux actualisations, un badge que vous venez de faire n’est pas encore connu. Le détail indique quand les heures ont été lues pour la dernière fois, et **Actualiser** les redemande — au plus toutes les cinq minutes.
