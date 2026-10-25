# Publier sur l'App Store et Google Play

L'appli est déjà une application web installable (PWA). Pour les stores, on l'emballe avec **Capacitor** (dossier `mobile/`) : le même code, dans une coquille native.

## Ce qu'il faut
- **Apple** : un Mac avec Xcode, et un compte Apple Developer (abonnement annuel payant).
- **Google** : Android Studio (Windows, Mac ou Linux) et un compte Google Play Console (frais d'inscription uniques).
- Les montants et les règles changent : vérifie sur developer.apple.com et play.google.com/console.
- Un serveur en ligne stable avec ton vrai domaine (voir `DEPLOIEMENT.md`).

## Étapes
1. Dans `public/config.js`, indique l'adresse du serveur : `window.TENDRA_API = 'https://app.tondomaine.fr';`
2. Dans `mobile/` :
   ```bash
   npm install
   npx cap add android      # et/ou : npx cap add ios
   npx cap sync
   npx cap open android     # ou : npx cap open ios
   ```
3. Icônes et écrans de démarrage : utilise `public/icons/icon-1024-store.png` (sans transparence) avec l'outil `@capacitor/assets`.
4. Android Studio / Xcode : choisis l'identifiant d'application (`fr.tendra.app` dans `mobile/capacitor.config.json`, à garder identique partout), compile, teste sur un vrai téléphone.
5. Test interne : **TestFlight** (iOS) et **test interne** (Google Play) avant toute publication.

## Les achats : la règle qui change tout
Dans une application iOS ou Android, les abonnements numériques doivent en principe passer par les **achats intégrés** d'Apple et de Google (qui prennent une commission), pas par Stripe. Les règles évoluent selon les pays : relis les guidelines Apple (section « Paiements ») et les règles Google Play avant de décider. Le code est prêt pour la voie standard :
1. Crée tes produits d'abonnement dans App Store Connect et Google Play Console.
2. Crée un projet **RevenueCat**, relie les deux stores, crée un droit d'accès (« entitlement ») et une offre avec les packages `$rc_annual` et `$rc_monthly`.
3. Mets ta clé publique RevenueCat dans `public/config.js` (`window.TENDRA_RC_KEY`).
4. Dans RevenueCat → Intégrations → Webhooks : adresse `https://TON-SITE/api/webhooks/revenuecat`, en-tête Authorization = la valeur de `REVENUECAT_WEBHOOK_AUTH` côté Render.
5. L'appli identifie l'acheteur par son identifiant Tendra : le serveur débloque l'accès tout seul à la réception du webhook.
Le pass 6 semaines (paiement unique) n'est branché que sur Stripe ; pour les stores, crée-le comme achat « consommable » ou « non renouvelable » et adapte le webhook si tu le veux.

**Ce code d'achat natif n'a pas pu être testé ici** (il demande un compte développeur et un appareil) : prévois du temps de mise au point.

## Notifications de rappel
Dans l'appli native, le rappel quotidien utilise des notifications locales programmées sur le téléphone (plugin `@capacitor/local-notifications`) : elles sonnent app fermée, sans serveur. Demande l'autorisation à l'activation (déjà fait dans le code).

## Ce que les relecteurs vérifieront
- **Suppression de compte dans l'appli** : présente (*Profil → Supprimer mon compte*).
- **Politique de confidentialité** accessible par un lien public : `https://TON-SITE/legal/privacy.html` (à faire valider).
- **Déclarations de confidentialité** : données de santé et de forme (sommeil, douleur…), coordonnées, identifiants, achats. Remplis-les fidèlement.
- **Allégations de santé** : Tendra doit rester présenté comme un outil d'entraînement, sans diagnostic ni promesse de guérison. Évite les mots « traitement », « soigne », « rééducation » dans la fiche du store.
- **Compte de test** pour les relecteurs : crée un compte et donne-lui un accès permanent (requête SQL dans `DEPLOIEMENT.md`), puis indique l'e-mail et le mot de passe dans les notes de soumission.
- **Âge** : l'appli est réservée aux 16 ans et plus ; choisis la classification en conséquence.
- Captures d'écran (téléphones), description, catégorie « Santé et forme », adresse d'assistance.

Une première soumission est souvent refusée avec des demandes de correction : prévois plusieurs allers-retours, et ne fixe pas de date de lancement avant l'approbation.
