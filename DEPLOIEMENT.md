# Déployer Tendra pour tester (GitHub + Render)

Temps estimé : 1 à 2 heures, la plus grande partie pour Stripe.

## 0. Avant de commencer
Comptes gratuits à créer : **GitHub**, **Render**, **Stripe** (mode test, aucune société nécessaire pour tester), **Resend** (e-mails, facultatif au début). Sur ton ordinateur : Node 22.

## 1. Vérifier en local
```bash
npm install
npm test        # doit afficher « fail 0 »
npm start       # ouvre http://localhost:3000, crée un compte, fais une séance
```

## 2. Mettre le code sur GitHub
```bash
git init && git add . && git commit -m "Tendra"
# crée un dépôt PRIVÉ sur github.com, puis :
git remote add origin https://github.com/TON-COMPTE/tendra.git
git branch -M main && git push -u origin main
```

## 3. Déployer sur Render
1. Render → **New + → Blueprint** → choisis le dépôt. Render lit `render.yaml` et crée le site web **et** la base Postgres.
2. Quand Render demande les variables « sync: false », mets pour l'instant seulement `BASE_URL` (laisse vide les autres).
3. Après le premier déploiement, Render te donne une adresse (par exemple `https://tendra.onrender.com`). Remets-la dans `BASE_URL` (Environment) et redéploie.
4. Ouvre l'adresse : tu dois voir l'écran d'accueil. `https://…/healthz` doit répondre `{"ok":true}`.

Tu peux déjà envoyer le lien à tes testeurs : inscription, séances et sauvegarde fonctionnent.

## 4. Activer les paiements (Stripe, mode test)
1. Stripe → mode **Test**. *Produits* → crée « Tendra » avec **3 prix** : mensuel 7,99 € (récurrent, mensuel), annuel 49,99 € (récurrent, annuel), pass 19,99 € (**paiement unique**). Copie les 3 identifiants `price_…`.
2. *Développeurs → Clés API* : copie la clé secrète `sk_test_…`.
3. *Développeurs → Webhooks → Ajouter un endpoint* : URL `https://TON-SITE/api/webhooks/stripe`, événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copie la clé de signature `whsec_…`.
4. *Paramètres → Facturation → Portail client* : active-le (résiliation, moyen de paiement, factures).
5. Dans Render → Environment : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_PASS`. Redéploie.
6. Test : fais finir ton essai (voir plus bas), choisis une offre, paie avec la carte de test `4242 4242 4242 4242` (date future, CVC quelconque). L'accès doit se débloquer en quelques secondes ; *Profil → Gérer mon abonnement* ouvre le portail.

Pour faire finir un essai à la main (compte de test), dans la console SQL de la base Render :
```sql
UPDATE users SET trial_end = 1 WHERE email = 'ton@email.fr';
```
Pour offrir un accès gratuit (relecteurs des stores, amis) :
```sql
UPDATE users SET pass_until = 4102444800000 WHERE email = 'ami@email.fr';
```

## 5. E-mails (mot de passe oublié)
Resend → crée une clé API → `RESEND_API_KEY`, et `EMAIL_FROM` (par exemple `Tendra <no-reply@tondomaine.fr>`). Sans domaine vérifié, Resend n'envoie qu'à ton propre e-mail : vérifie ton domaine avant d'inviter du monde. Sans clé, le lien de réinitialisation est écrit dans les logs Render (suffisant pour tester seul).

## 6. Notifications de rappel (facultatif)
```bash
npx web-push generate-vapid-keys
```
Mets `VAPID_PUBLIC`, `VAPID_PRIVATE` et `VAPID_SUBJECT` (`mailto:ton@email.fr`) dans Render. Sur iPhone, les notifications web ne marchent qu'après « Ajouter à l'écran d'accueil » (iOS 16.4 ou plus récent). Les rappels partent depuis le serveur : **il doit être éveillé** (voir limites ci-dessous).

## 7. Limites du plan gratuit (à vérifier sur render.com/pricing)
- Le site gratuit se met en veille après un moment d'inactivité et met environ une minute à se réveiller ; les rappels ne partent pas pendant la veille.
- La base Postgres gratuite est temporaire (durée limitée) : ne garde pas de vraies données dessus.
- Convient pour **tester avec des amis**, pas pour le public.

## 8. Avant d'ouvrir au public
- [ ] Plans payants Render (site toujours éveillé + base avec sauvegardes).
- [ ] Nom de domaine à toi, branché sur Render (`BASE_URL` mis à jour, webhook Stripe mis à jour).
- [ ] Stripe en mode **Live** (nouvelles clés et nouveaux prix), statut d'entreprise et compte bancaire renseignés.
- [ ] Pages légales relues par un juriste (`public/legal/*.html`), remplir tous les [crochets].
- [ ] Exercices validés par un kiné ou préparateur physique (`docs/validation-professionnel.csv`).
- [ ] Nom vérifié (voir `docs/RESTE-A-FAIRE.md`).
- [ ] Domaine d'e-mail vérifié, test de réinitialisation de mot de passe.
- [ ] Tester sur de vrais téléphones (iPhone et Android), avec et sans réseau.
