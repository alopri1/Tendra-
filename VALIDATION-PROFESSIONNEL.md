# Faire valider les exercices par un professionnel

À remettre à un **kinésithérapeute du sport**, un **médecin du sport** ou un **préparateur physique** diplômé, avec le fichier `validation-professionnel.csv` (s'ouvre dans Excel ou Google Sheets : séparateur « ; », encodage UTF-8).

## Ce qu'il y a dans le fichier
71 exercices (Achille et rotulien) avec : type, niveau minimum, séries × répétitions ou durée, **charge en % de la charge max**, repos, consigne affichée à l'utilisateur, objectifs visés, note de puissance, animation et accessoires. Deux colonnes vides à remplir : **Validé** (oui / non / à modifier) et **Commentaire**.

## Les points à faire vérifier
1. Les **pourcentages de charge** (jusqu'à 85-90 % en niveaux Confirmé et Avancé) et les **repos** (150 s pour les séries lourdes).
2. Les **progressions** : niveau → phase de 6 semaines → cycle suivant (la difficulté monte à chaque cycle ; les charges proposent +5 %).
3. Les **règles d'adaptation** du check-in : douleur de 3 à 4 → séance allégée (une série en moins, sans sauts) ; douleur de 5 ou plus, ou sommeil / énergie / humeur au plus bas → séance de récupération ; difficulté de la veille de 9 ou 10 → allègement.
4. Les **limites de sécurité** : niveau Avancé et exercices à impact accessibles à partir de quel âge ? Les moins de 50 ans seulement pour les plus lourds ?
5. Les **consignes** de chaque exercice (exactes, claires, sans risque d'erreur de geste).
6. Les **tests hebdomadaires** (montées sur pointes une jambe, maintien chaise…) : bons indicateurs ? critères d'arrêt ?
7. Les **messages affichés** (conditions d'utilisation, case « pas de blessure en cours ») : suffisants à ses yeux ?
8. Les **notes de puissance** (1 à 5) : ce sont des estimations de l'auteur, à corriger.

## Modèle de validation
> Je soussigné(e) [nom, titre, numéro RPPS / ADELI le cas échéant] ai relu les 71 exercices, les dosages, les progressions et les règles d'adaptation de l'application Tendra à la date du [date], avec les modifications indiquées dans la colonne « Commentaire ». Cette relecture ne constitue pas une validation médicale individuelle des utilisateurs.
> Signature :

Garde ce document : il te protège et rassure les stores, les assureurs et les clubs. Pense aussi à une **assurance responsabilité civile professionnelle** adaptée à ton activité.

## Modifier un exercice
Les exercices sont dans `public/index.html` (cherche `const T=`). Chaque ligne : `[nom, type, niveau, dosage, consigne, objectifs, puissance]`. Après modification : `npm test`, puis `node build/gen_csv.mjs` pour régénérer le fichier de validation.
