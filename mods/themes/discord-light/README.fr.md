# Discord Light

La feuille de style de Discord Dark avec la palette claire de Discord. Pas un
second thème qui lui ressemble : le même fichier, à partir de la première règle,
avec un seul bloc de couleurs changé — et un test qui échoue si les deux
divergent.

- Tout Discord Dark : icônes rondes dans le rail avec la pastille blanche qui
  passe du point à la barre, la barre latérale de Discord et ses lignes de
  32 px, la barre colorée à gauche d'un aperçu de lien, les mentions en pastille
  blurple, les barres de défilement de Discord.
- Conversation blanche sur chrome gris, accent blurple, avatars circulaires.
- La pile typographique gg sans, avec ses replis, pour que le rendu soit juste
  que la police soit installée ou non.
- Amène la colonne des membres et le bandeau de compte, les deux parties de
  Discord que le CSS ne sait pas faire. Le panneau demande avant d'activer l'un
  ou l'autre.

Les couleurs sont les jetons de design publiés par Discord pour son thème clair,
nommés dans la feuille de style à côté des valeurs. Celles de Discord Dark ont
été relevées sur une capture du vrai client : les deux disent honnêtement qu'ils
ne viennent pas de la même source.

Deux d'entre elles ne viennent ni de l'un ni de l'autre : Discord peint la
pastille d'une mention en blurple à 10 % par-dessus ce qu'il y a derrière. Cela
fonctionne là-bas et pas ici, parce que Slack place une mention sur le volet,
sur une ligne survolée et dans une carte surélevée — une pastille translucide y
prend trois couleurs différentes. Elle est donc aplatie à la valeur qu'elle
donne sur le volet, avec un texte assombri pour y rester lisible.
