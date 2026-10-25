# Ce qui reste à faire (et que seul un humain peut faire)

## Fait et testé automatiquement (25 tests)
Comptes, connexion, mot de passe oublié, synchronisation de l'état, essai de 7 jours, droit d'accès, Checkout et portail Stripe (appels simulés), webhooks Stripe signés (abonnement, renouvellement, échec, annulation, pass, doublons), webhook RevenueCat, export et suppression du compte, rappels (calcul des heures), mode natif (jeton, CORS), parcours complet de l'application face au vrai serveur (inscription, profil, séance, difficulté, reconnexion, cycle suivant, paywall, suppression).

## Écrit mais PAS testé avec le vrai service (à vérifier avant le lancement)
| Élément | Pourquoi |
|---|---|
| Base **Postgres** | Les tests utilisent SQLite ; le même SQL est prévu pour Postgres, mais jamais exécuté sur Postgres ici. |
| **Paiement Stripe réel** | Les appels à Stripe sont simulés. Fais un paiement en mode test (DEPLOIEMENT.md, étape 4). |
| **Notifications push** web | Nécessitent des clés VAPID et un vrai navigateur. |
| **E-mails** Resend | Nécessitent une clé et un domaine vérifié. |
| **Rendu sur téléphone** | Mannequin 3D, animations, son, voix : vérifiés sur des images générées et par tests logiques, jamais sur un vrai écran. |
| **Appli native** (Capacitor, achats RevenueCat, notifications locales) | Demande Xcode / Android Studio et des comptes développeur. |

## Limite de sécurité à connaître
Le blocage après l'essai est appliqué dans l'application, mais la bibliothèque d'exercices est livrée avec le code : quelqu'un de technique pourrait le contourner. Acceptable pour une bêta ; avant le lancement public, il faut servir les exercices depuis le serveur, derrière un point d'accès réservé aux comptes actifs.

## À faire par toi
1. **Tester sur de vrais téléphones** et noter tout ce qui cloche.
2. **Faire valider les exercices** par un professionnel (`VALIDATION-PROFESSIONNEL.md`).
3. **Pages légales** : remplir les [crochets] et les faire relire par un juriste. Droit de rétractation et mentions légales en particulier.
4. **Statut d'entreprise** (par exemple micro-entreprise), compte bancaire pro, Stripe en mode Live, TVA à cadrer avec un comptable.
5. **Nom et marque « Tendra »** : je n'ai pas pu vérifier sa disponibilité (la recherche en ligne n'a rien donné de concluant, ce qui ne prouve pas qu'il est libre). Cherche sur : INPI (base marques), EUIPO (TMview), WIPO (Global Brand Database), l'App Store, Google Play, les noms de domaine (.fr, .com), Instagram, TikTok. Prends un conseil en propriété industrielle avant de déposer la marque.
6. **Démonstrations pro** : le mannequin est un rendu par code. Pour les exercices clés, filme un coach (voir `public/media/README.md` : la vidéo remplace le mannequin exercice par exercice).
7. **Assurance** responsabilité civile professionnelle.
8. **Comptes développeur** Apple et Google, fiches de store, captures d'écran, classification d'âge (`STORES.md`).

## Évolutions possibles ensuite
Plus d'exercices et de variantes, programmes pour d'autres tendons, bibliothèque de vidéos, statistiques avancées (charges maximales estimées, tendance de forme), partage avec un coach, tableau de bord administrateur.
