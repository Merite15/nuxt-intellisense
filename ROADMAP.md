# Roadmap — idées de fonctionnalités

Liste de pistes d'évolution pour l'extension, non implémentées à ce jour. Chaque
entrée indique son **impact** (valeur perçue pour l'utilisateur final) et sa
**facilité** (effort d'implémentation, en tenant compte de l'infrastructure déjà en
place : caches, watchers, mock de test, `TextUtils.extractBalancedBlock`, etc.).

> Pour ce qui est déjà livré (détection de code mort, doublons de noms composants/
> composables/stores/plugins/server middleware-plugins, comptage `server/api`,
> références fantômes middleware/layout, clés `definePageMeta` inconnues, hover
> provider, vue "Nuxt Structure", dossiers ignorés configurables...), voir
> [CHANGELOG.md](./CHANGELOG.md).

## Légende

- **Impact** : 🔴 Élevé · 🟠 Moyen · 🟡 Faible
- **Facilité** : 🟢 Facile (quelques heures, réutilise l'existant) · 🟡 Moyenne (nouveau service ou refonte ciblée) · 🔴 Difficile (nouvelle sous-système, risque de régression ou de performance)

## Facile

| Fonctionnalité | Impact | Facilité | Notes |
|---|---|---|---|
| **Quick Fix "Créer le fichier manquant"** | 🔴 Élevé | 🟢 Facile | Complément direct de la détection de références fantômes : un `CodeActionProvider` qui, sur le warning "aucun middleware nommé X", propose de créer `middleware/X.ts` avec un squelette `defineNuxtRouteMiddleware`. Le diagnostic existe déjà, il ne manque que l'action. |
| **Détection des conflits de routes** | 🟠 Moyen | 🟢 Facile | Deux fichiers sous `pages/` qui résolvent à la même route (ex: `pages/users/[id].vue` et `pages/users/[slug].vue`). Même schéma que les doublons de noms déjà en place — dérivation du nom de route à partir du chemin, groupage, warning si collision. |
| **Références fantômes de slots** | 🟠 Moyen | 🟢 Facile | Un `<template #foo>` (ou `v-slot:foo`) passé à un composant enfant dont le `<slot name="foo">` n'existe plus/pas dans sa définition (typo, ou slot retiré du parent lors d'un refacto). `ComponentService.getComponentMetadata()` extrait déjà les slots déclarés (livré avec le hover props/slots) — il ne reste qu'à résoudre le composant utilisé dans le template courant et comparer, sur le même schéma que `PageMetaValidationService`. Les slots dynamiques (`<slot :name="x">`) sont à ignorer plutôt que source de faux positifs. |
| **Références fantômes de props** | 🟠 Moyen | 🟢 Facile | Symétrique côté props : une prop passée sur une balise (`<MyButton foo="x">`) absente de `defineProps` du composant résolu. Réutilise la même extraction que ci-dessus (`getComponentMetadata().props`). Attention aux faux positifs : attributs HTML natifs, `v-bind="obj"` dynamique, et props auto-héritées (`$attrs`) doivent être exclus. |

## Impact moyen

| Fonctionnalité | Impact | Facilité | Notes |
|---|---|---|---|
| **Clés `runtimeConfig` inutilisées/fantômes** | 🟠 Moyen | 🟡 Moyenne | Symétrique de la détection déjà en place : comparer les clés déclarées dans `runtimeConfig`/`runtimeConfig.public` (nuxt.config ou fichier séparé, comme pour `routeRules`) avec les usages réels de `useRuntimeConfig().xxx`. Bon candidat car les typos sur ces clés cassent silencieusement en prod (valeur `undefined`, pas d'erreur TS). |
| **Support multi-root workspace réel** | 🟠 Moyen | 🔴 Difficile | Aujourd'hui, `nuxtProjectRoot` est déterminé une seule fois (au premier fichier ouvert) et figé pour toute la session. Un workspace avec plusieurs dossiers racine (plusieurs projets/layers Nuxt indépendants ouverts ensemble) donnerait des résultats incohérents pour les dossiers autres que le premier. Corriger proprement demande de résoudre la racine **par document** plutôt qu'une fois globalement — touche `NuxtIntellisense.ts` en profondeur. |
| **Hover provider étendu aux composables/stores** | 🟠 Moyen | 🟡 Moyenne | Le hover livré en 0.9.0 ne couvre que les tags de composants. L'étendre aux appels `useXxx()` et aux stores demande de réutiliser la logique de comptage par item exposé de `ComposableService`/`StoreService`, plus complexe qu'un simple lookup par nom de fichier. |

## Plus ambitieux

| Fonctionnalité | Impact | Facilité | Notes |
|---|---|---|---|
| **Clés i18n manquantes/inutilisées** (`@nuxtjs/i18n`) | 🔴 Élevé | 🔴 Difficile | Gros point de douleur réel en production (texte manquant silencieux). Demande de parser les fichiers de traduction (JSON/YAML/JS selon la config du module) en plus du code source, et de gérer les clés imbriquées (`t('user.profile.title')`). Nouveau sous-système à part entière. |
| **Auto-complétion des imports non utilisés** | 🔴 Élevé | 🔴 Difficile | Proposer une complétion pour un composant/composable non encore utilisé dans le fichier courant. Demande un `CompletionItemProvider` complet et une indexation en continu (pas seulement à la demande comme aujourd'hui) — changement d'architecture, risque de régression sur les perfs qu'on vient de corriger. |
| **Renommage propagé** | 🟠 Moyen | 🔴 Difficile | Renommer un fichier composant/composable/store et proposer de mettre à jour tous les usages détectés. Techniquement faisable en réutilisant la recherche de références existante + `WorkspaceEdit`, mais le risque de faux positifs (les regex ne sont pas un vrai parseur AST) rend les modifications automatiques plus dangereuses qu'un simple warning — nécessite une UI de confirmation soignée. |

## Recommandation

Le meilleur rapport effort/valeur immédiat : **Quick Fix "Créer le fichier manquant"**
— elle capitalise directement sur la détection de références fantômes livrée en 0.8.4
et transforme un diagnostic passif en correction en un clic.
