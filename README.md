# Vidéos de démonstration (optionnel)

Pour remplacer le mannequin par une vraie vidéo sur un exercice, déposez le fichier ici (MP4 H.264, vertical, 5 à 15 s, sans son, moins de 5 Mo)
et déclarez-le dans `index.json`, avec le nom EXACT de l'exercice :

```json
{
  "Squat lesté lourd": "/media/squat-leste-lourd.mp4",
  "Montées sur pointes lentes": "/media/pointes-lentes.mp4"
}
```

Un bouton « Vidéo » apparaît alors dans la séance guidée pour cet exercice. La liste exacte des noms est dans `docs/validation-professionnel.csv`.
Si les vidéos sont hébergées ailleurs (CDN), renseignez la variable d'environnement `MEDIA_ORIGIN` du serveur.
