# Quelio

Une fine barre en haut de Slack qui montre où en est votre semaine par rapport à l’objectif Quelio, à quelle heure partir aujourd’hui, et où en est la pause déjeuner.

- **La barre** se place dans la barre du haut de Slack, à côté de la recherche : une fine jauge pour la semaine, une plus fine encore pour la journée, le total de la semaine et une ligne sur l’instant présent — *Encore 2h08 · départ 17:24*, *Pause · 32 min / 1h · reprise à 13:17*, *Départ possible*. Dans une fenêtre étroite, elle se raccourcit d’elle-même, jusqu’à la jauge seule.
- **Un clic** ouvre le détail : la semaine (effectué, objectif, restant), la journée (arrivée, ce que Quelio décompte jusqu’ici, pause déjeuner, reste à faire, départ conseillé et plage de départ autorisée) et chaque jour de la semaine.
- **Elle suit l’horloge.** Quelio est interrogé environ une fois par heure pendant la journée de travail, et ni la nuit ni le week-end ; la durée de la pause et le reste à faire sont recalculés localement à partir de la dernière réponse, si bien que la barre n’a jamais une heure de retard.

## Mise en route

1. Installez puis activez Quelio depuis l’onglet Parcourir.
2. Cliquez sur **Quelio · Se connecter** dans la barre du haut. La première fois, l’**adresse du quelio-api** de votre entreprise est demandée — le serveur, terminé par une barre oblique, par exemple `https://example.com/quelio-api/`. Elle est gardée dans les réglages du plugin, où vous pouvez la modifier.
3. Connectez-vous avec votre identifiant et votre mot de passe Quelio.

Les réglages permettent aussi de choisir la fréquence d’actualisation (une heure au minimum), ce qu’affiche la barre — progression et état du jour, progression et reste à faire, ou progression seule — et les règles de l’entreprise, ci-dessous.

## Comment la suggestion est calculée

L’objectif hebdomadaire est celui de Quelio (`minutes_objective`, ou 38 heures s’il n’en fournit pas). Ce qui reste est réparti **à parts égales** sur les jours ouvrés restants de la semaine, à ceci près qu’aucun jour ne peut contenir plus qu’il ne peut — du début à la fin de la journée décomptée, avec une heure de pause — et qu’un jour qui ne peut pas prendre sa part laisse le reste aux autres. Cette part est l’objectif du jour. Le départ conseillé est l’heure à laquelle vous l’atteignez, jamais avant le départ le plus tôt ni après le plus tard.

Si les heures restantes ne peuvent pas être faites même en restant aussi tard que permis chaque jour restant, le plugin le dit, avec ce qui manque, et propose de rester jusqu’à l’heure maximale — jamais une heure qui enfreint une règle.

## Les règles

Ce sont les valeurs par défaut, et chacune est un réglage, pour qu’une entreprise dont le quelio-api est configuré autrement puisse s’y conformer. Une valeur illisible (`8h30` au lieu de `08:30`) est remplacée par sa valeur par défaut. Les heures s’écrivent `HH:MM`, les durées en minutes.

- **Seule la plage 08:30–18:30 est décomptée, 08:30–17:30 le vendredi.** Les badges en dehors comptent à partir de ces heures ou jusqu’à elles : la fin est donc aussi le départ le plus tard proposé.
- **Personne ne part avant 16:30**, quel que soit le jour, sauf avec l’après-midi en congé. Un jour qui atteint sa part plus tôt finit quand même à 16:30, et le temps fait au-delà de la part allège les jours suivants.
- **Arrivée avant 09:00.**
- **Les deux pauses courtes durent 7 minutes chacune et sont payées** : ne pas les prendre rend ce temps, 14 minutes par jour. Quelio ne crédite celle du matin qu’une fois 12:00 passée, et celle de l’après-midi qu’à partir de 16:00 : partir juste avant fait perdre ses 7 minutes.
- **La pause déjeuner commence entre 12:00 et 13:00 et compte au moins une heure.** Badger moins ne permet pas de partir plus tôt : la différence est déduite, dans la limite des 14 minutes de pauses. Seule la partie entre 12:00 et 14:00 compte pour son heure : une pause commencée à 11:50 atteint son heure à 13:00, et revenir après 14:00 d’une pause commencée à temps ne retire rien. 14:00 est aussi l’heure de reprise la plus tardive.
- **Payé = effectif + pauses − ce qui manque à la pause déjeuner pour faire son heure.**

Une pause déjeuner commencée après 13:00 ne peut pas atteindre son heure avant 14:00, et rien après 14:00 n’y compte : la barre indique donc de reprendre avant 14:00, et non une heure après le début.

Les règles de décompte — la plage décomptée, les pauses, la plage de midi et son minimum — doivent correspondre au `config.php` du serveur (`start_limit_minutes`, `end_limit_minutes`, `pause_time`, `morning_break_threshold`, `afternoon_break_threshold`, `noon_break_start`, `noon_break_end`, `noon_minimum_break`) ; l’aide de chaque réglage nomme sa clé. quelio-api n’a qu’une fin de journée pour tous les jours : un vendredi qui finit plus tôt est prévu ici sans que Quelio l’impose. Quand les deux divergent, le décompte de Quelio l’emporte : le chiffre du jour suit sa dernière réponse, et seule la progression depuis est calculée localement.

**Congés.** Dans le détail, un jour sans badge peut être marqué comme congé : il compte pour un cinquième de l’objectif hebdomadaire et ne demande aucune heure. Tout jour peut être marqué comme **après-midi de congé** : il compte pour un dixième de l’objectif, ne contient qu’une matinée — finie au plus tard à 13:00, sans pause déjeuner — et n’a pas de départ minimum à 16:30. Les deux ne valent que pour la semaine en cours.

## Ce qui est envoyé, et où

- **Un seul type de requête, vers une seule adresse** : un `POST` vers l’adresse du quelio-api indiquée dans les réglages, avec `action=login` et votre identifiant Quelio accompagné soit de votre mot de passe (une fois, pour la connexion), soit du jeton renvoyé par Quelio. Rien de Slack — aucun message, canal, espace de travail ni jeton Slack — n’est jamais envoyé.
- La requête est faite par le loader de BetterSlack via `api.net`, parce que quelio-api n’envoie pas d’en-têtes CORS et qu’une page dans Slack ne peut pas lire sa réponse. Le manifeste déclare le réglage d’adresse sous `network`, et le loader refuse toute autre adresse, le http non chiffré et les redirections.
- Chaque actualisation fait se connecter Quelio à Kelio, c’est pourquoi quelio-api demande de ne pas dépasser un appel par heure. Le plugin n’interroge donc que les jours ouvrés, d’une demi-heure avant le début de la journée décomptée jusqu’à sa fin, plus une fois après la fin pour voir le départ ; jamais la nuit, et le week-end seulement s’il n’a rien pour la semaine. Un échec est attendu — plus longtemps à chaque fois, ou aussi longtemps que Quelio l’indique après un 429 — et cette attente, comme l’heure de la dernière requête, survit à un redémarrage ou à un changement de réglage. Un mot de passe refusé n’est jamais réessayé dans votre dos : cinq échecs en cinq minutes bloquent tout votre réseau pendant un moment.

## Ce qui est conservé, et comment

- **Le mot de passe n’est pas enregistré.** Il quitte le formulaire dès que vous appuyez sur Se connecter, et n’est envoyé qu’une fois.
- **Le jeton renvoyé par Quelio le contient pourtant.** quelio-api construit le jeton à partir de votre identifiant, de votre mot de passe chiffré avec la clé du serveur et d’une empreinte SHA-256 non salée du mot de passe : qui détient le jeton peut l’utiliser à votre place et en retrouver le mot de passe hors ligne. Il est à protéger comme le mot de passe.
- **Le jeton et les heures de la semaine sont gardés dans le dossier de données du plugin**, `~/.betterslack/data/quelio/` (via `api.data`), pour qu’un redémarrage ne demande pas de se reconnecter — avec `throttle.json`, l’heure de la dernière requête et l’échec éventuellement attendu. Ce sont des fichiers en clair, non chiffrés. Ils ne sont volontairement pas dans le fichier de réglages de BetterSlack, qui est copié dans chaque sauvegarde de BetterSlack et dans le script par lequel démarre chaque page de Slack.
- L’identifiant, pour le formulaire de connexion, et les jours et après-midis marqués en congé sont dans le fichier de réglages, avec les autres réglages du plugin.
- **Se déconnecter** efface le jeton, les heures et l’identifiant sur cet ordinateur. Supprimer le plugin ne le fait pas : BetterSlack garde le dossier de données d’un plugin quand celui-ci s’en va, alors déconnectez-vous d’abord. quelio-api ne permet pas de révoquer un jeton à distance : il reste valide côté serveur jusqu’à ce que Quelio l’invalide, ce que fait un échec de connexion à Kelio ou un changement de mot de passe.
- Quand Quelio indique que la session est terminée, le plugin se déconnecte et propose de se reconnecter ; il ne réessaie jamais avec un jeton qu’il sait expiré.

## Limites

- L’heure est celle de l’horloge de votre ordinateur, qui est celle de la badgeuse pour qui se trouve dans le même fuseau horaire.
- Entre deux actualisations, un badge que vous venez de faire n’est pas encore connu. Le détail indique quand les heures ont été lues pour la dernière fois, et **Actualiser** les redemande — au plus toutes les cinq minutes.
