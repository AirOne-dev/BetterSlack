// What the Mods panel says, in every language it says it in.
//
// Every mod in this repository is required to ship English and French, and a
// test fails one whose tables disagree -- while the panel around them was
// English only. A French user had French mods inside an English window, which
// is the kind of seam that makes a product feel assembled rather than built.
//
// Same rules as a mod's own dictionaries, through the same `api.i18n`
// machinery: English is required and is the fallback for an unknown language
// and for a missing key, and a key missing everywhere renders as the key rather
// than as a blank.

export const PANEL_STRINGS = {
  en: {
    title: 'BetterSlack',
    close: 'Close',
    themes: 'Themes',
    plugins: 'Plugins',
    css: 'Custom CSS',
    about: 'About',

    installed: 'Installed',
    enabled: 'Enabled',
    browse: 'Browse',
    search: 'Search mods…',
    searchClear: 'Clear',
    noMatch: 'Nothing matches that search.',
    allInstalled: 'Everything in the catalogue is already installed.',
    nothingInstalled: 'Nothing installed yet — the Browse shelf is where you start.',
    nothingEnabled: 'Nothing switched on yet.',
    byLine: 'v{version} · by {author}',
    filterAll: 'All',

    install: 'Install',
    enable: 'Enable',
    disable: 'Disable',
    remove: 'Remove',
    notRunning: 'not running',
    settingsCount: 'Settings ({count})',
    settingsHide: 'Hide settings',

    uses: 'Uses {names}',
    needs: 'Needs {names}',
    enableIt: 'Enable it',
    enableThem: 'Enable them',
    enableAll: 'Enable all {count}',
    notInCatalogue: 'Not in the catalogue: {names}',
    cancel: 'Cancel',
    requiresTitle: '{name} needs {count} plugin(s)',
    requiresBody:
      'A theme is CSS. This one needs behaviour CSS cannot do, which lives in plugins — code that keeps running after the theme is switched off. Enabling them is your call.',

    safeTitle: 'Safe mode — nothing is loaded',
    safeAsked: 'Started with --safe. Your mods are untouched; start again without it to load them.',
    safeCrashed:
      '{reason}. Switch off whatever you suspect, then start BetterSlack again.',

    updateTitle: 'An update is available',
    updateGit: '{count} commit(s) behind{headline}. Updating pulls and rebuilds.',
    updateHeadline: ' — latest: {subject}',
    updatePackage:
      'Version {latest} is out; this is {current}. Updating downloads it from GitHub and replaces this copy — your mods and settings are kept, they live outside it.',
    updateGo: 'Update and restart',
    updateGitHub: 'Open GitHub',
    updatePulling: 'Pulling and rebuilding…',
    updateDownloading: 'Downloading and rebuilding…',
    updateDone: 'Updated. Slack is restarting…',
    updateFailed: 'Could not update: {reason}',

    modUpdateTitle: '{name} {version} is out',
    modUpdateBody: 'You have {current}. Updating replaces this mod alone, and reapplies it if it is on.',
    modUpdateGo: 'Update',
    modUpdateWorking: 'Downloading…',

    cssHint:
      'Applied after every theme, so it always wins. Slack exposes its palette as CSS custom properties (--dt_color-*), which is a steadier target than its class names.',
    cssSave: 'Save and apply',
    cssApplied: 'Applied.',

    aboutBody:
      'BetterSlack injects into the Slack renderer over the Chrome DevTools Protocol, carried on a private pipe rather than a debugging port — nothing listens on the network. It does not modify Slack.app, so Slack updates cannot break your install, but mods stay loaded only while the loader runs.',
    hotReload: 'Hot reload',
    hotReloadHint: 'Reapply a mod as soon as its file changes on disk.',
    version: 'Version',
    catalogue: 'Catalogue',
    yourMods: 'Your mods',
    transport: 'Transport',
    repository: 'Repository',
    contribute: 'Submit a mod',

    remoteHint: 'Install from a GitHub URL — a repository, or a folder inside one.',
    remotePlaceholder: 'github.com/someone/their-mods/tree/main/my-plugin',
    remoteFetch: 'Read it',
    remoteReading: 'Reading…',
    remoteInstalling: 'Installing…',
    remoteInstalled: '{name} installed. It is off until you switch it on.',
    remoteAccept: 'Install anyway',
    remoteFrom: 'From',
    remoteKind: 'Kind',
    remoteScripts: 'Code that will run',
    remoteNoScripts: 'none — this one is stylesheets only',
    remoteSize: 'Size',
    remoteBadge: 'unreviewed',
    remoteBadgeHint: 'From {source}. Nobody in this project has read it.',
    remoteWarningPlugin:
      'This is somebody else’s code, and nobody here has read it. A plugin runs unsandboxed in your signed-in Slack: it can read every message you can, and the session token. Install it only if you trust whoever wrote it.',
    remoteWarningTheme:
      'This is somebody else’s theme, and nobody here has read it. A theme is CSS, so it cannot read your messages — but it can hide or fake parts of the interface. Install it only if you trust whoever wrote it.',

    backupTitle: 'Backup',
    backupHint: 'Your settings and the mods you wrote or installed yourself. Catalogue mods come back with the project, so they are not in it.',
    backupExport: 'Save a backup',
    backupImport: 'Restore one',
    backupSaved: 'Saved to your downloads.',
    backupWorking: 'Restoring…',
    backupRestored: 'Restored {detail}.',

    diagTitle: 'What the mods cost',
    diagHint: 'Time spent starting, and how often Slack has undone each mod’s work.',
    diagTiming: '{ms} ms · {mounts} mounts',
    diagCopy: 'Copy a report',
    diagCopied: 'Copied',
    diagCopyFailed: 'Could not copy',

    paletteSearch: 'Type a command…',
    paletteEmpty: 'Nothing matches.',
    paletteOpenPanel: 'Open BetterSlack',
    paletteEnable: 'Enable',
    paletteDisable: 'Disable',
  },

  fr: {
    title: 'BetterSlack',
    close: 'Fermer',
    themes: 'Thèmes',
    plugins: 'Plugins',
    css: 'CSS personnalisé',
    about: 'À propos',

    installed: 'Installés',
    enabled: 'Actifs',
    browse: 'Parcourir',
    search: 'Rechercher un mod…',
    searchClear: 'Effacer',
    noMatch: 'Aucun résultat pour cette recherche.',
    allInstalled: 'Tout le catalogue est déjà installé.',
    nothingInstalled: 'Rien d’installé pour l’instant — commencez par Parcourir.',
    nothingEnabled: 'Rien d’activé pour l’instant.',
    byLine: 'v{version} · par {author}',
    filterAll: 'Tous',

    install: 'Installer',
    enable: 'Activer',
    disable: 'Désactiver',
    remove: 'Retirer',
    notRunning: 'ne tourne pas',
    settingsCount: 'Réglages ({count})',
    settingsHide: 'Masquer les réglages',

    uses: 'Utilise {names}',
    needs: 'Nécessite {names}',
    enableIt: 'L’activer',
    enableThem: 'Les activer',
    enableAll: 'Activer les {count}',
    notInCatalogue: 'Absent du catalogue : {names}',
    cancel: 'Annuler',
    requiresTitle: '{name} nécessite {count} plugin(s)',
    requiresBody:
      'Un thème est du CSS. Celui-ci a besoin d’un comportement que le CSS ne sait pas faire, et qui vit dans des plugins — du code qui continue de tourner après l’extinction du thème. Les activer est votre décision.',

    safeTitle: 'Mode sans échec — rien n’est chargé',
    safeAsked:
      'Démarré avec --safe. Vos mods sont intacts ; relancez sans l’option pour les charger.',
    safeCrashed: '{reason}. Désactivez ce que vous suspectez, puis relancez BetterSlack.',

    updateTitle: 'Une mise à jour est disponible',
    updateGit: '{count} commit(s) de retard{headline}. La mise à jour tire et reconstruit.',
    updateHeadline: ' — dernier : {subject}',
    updatePackage:
      'La version {latest} est sortie ; celle-ci est la {current}. La mise à jour la télécharge depuis GitHub et remplace cette copie — vos mods et réglages sont conservés, ils vivent en dehors.',
    updateGo: 'Mettre à jour et relancer',
    updateGitHub: 'Ouvrir GitHub',
    updatePulling: 'Récupération et reconstruction…',
    updateDownloading: 'Téléchargement et reconstruction…',
    updateDone: 'Mis à jour. Slack redémarre…',
    updateFailed: 'Mise à jour impossible : {reason}',

    modUpdateTitle: '{name} {version} est sorti',
    modUpdateBody:
      'Vous avez la {current}. La mise à jour ne remplace que ce mod, et le réapplique s’il est actif.',
    modUpdateGo: 'Mettre à jour',
    modUpdateWorking: 'Téléchargement…',

    cssHint:
      'Appliqué après tous les thèmes, donc il gagne toujours. Slack expose sa palette en propriétés CSS (--dt_color-*), une cible plus stable que ses noms de classe.',
    cssSave: 'Enregistrer et appliquer',
    cssApplied: 'Appliqué.',

    aboutBody:
      'BetterSlack s’injecte dans le renderer de Slack via le Chrome DevTools Protocol, porté par un tube privé plutôt qu’un port de débogage — rien n’écoute sur le réseau. Slack.app n’est pas modifié, donc une mise à jour de Slack ne peut pas casser votre installation, mais les mods ne restent chargés que tant que le loader tourne.',
    hotReload: 'Rechargement à chaud',
    hotReloadHint: 'Réappliquer un mod dès que son fichier change sur le disque.',
    version: 'Version',
    catalogue: 'Catalogue',
    yourMods: 'Vos mods',
    transport: 'Transport',
    repository: 'Dépôt',
    contribute: 'Proposer un mod',

    remoteHint: 'Installer depuis une URL GitHub — un dépôt, ou un dossier dedans.',
    remotePlaceholder: 'github.com/quelquun/ses-mods/tree/main/mon-plugin',
    remoteFetch: 'Le lire',
    remoteReading: 'Lecture…',
    remoteInstalling: 'Installation…',
    remoteInstalled: '{name} installé. Il est éteint tant que vous ne l’allumez pas.',
    remoteAccept: 'Installer quand même',
    remoteFrom: 'Provenance',
    remoteKind: 'Type',
    remoteScripts: 'Code qui s’exécutera',
    remoteNoScripts: 'aucun — uniquement des feuilles de style',
    remoteSize: 'Taille',
    remoteBadge: 'non revu',
    remoteBadgeHint: 'Depuis {source}. Personne dans ce projet ne l’a lu.',
    remoteWarningPlugin:
      'C’est le code de quelqu’un d’autre, que personne ici n’a lu. Un plugin s’exécute sans bac à sable dans votre Slack connecté : il peut lire tous vos messages, et le jeton de session. Ne l’installez que si vous faites confiance à son auteur.',
    remoteWarningTheme:
      'C’est le thème de quelqu’un d’autre, que personne ici n’a lu. Un thème est du CSS, il ne peut donc pas lire vos messages — mais il peut masquer ou falsifier des parties de l’interface. Ne l’installez que si vous faites confiance à son auteur.',

    backupTitle: 'Sauvegarde',
    backupHint: 'Vos réglages et les mods que vous avez écrits ou installés vous-même. Les mods du catalogue reviennent avec le projet, ils n’y sont pas.',
    backupExport: 'Enregistrer une sauvegarde',
    backupImport: 'En restaurer une',
    backupSaved: 'Enregistré dans vos téléchargements.',
    backupWorking: 'Restauration…',
    backupRestored: 'Restauré : {detail}.',

    diagTitle: 'Ce que coûtent les mods',
    diagHint: 'Temps de démarrage, et combien de fois Slack a défait le travail de chacun.',
    diagTiming: '{ms} ms · {mounts} montages',
    diagCopy: 'Copier un rapport',
    diagCopied: 'Copié',
    diagCopyFailed: 'Copie impossible',

    paletteSearch: 'Tapez une commande…',
    paletteEmpty: 'Aucun résultat.',
    paletteOpenPanel: 'Ouvrir BetterSlack',
    paletteEnable: 'Activer',
    paletteDisable: 'Désactiver',
  },
};
