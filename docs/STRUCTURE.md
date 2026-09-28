# Détection de la structure (intro, couplets, refrains…)

Tout tourne dans le navigateur, sans modèle à télécharger (`web/src/dsp/structure.ts`, `web/src/dsp/segment.ts`).

## Méthode

1. **Découpage en passages** : segmentation « laplacienne » (McFee & Ellis, ISMIR 2014). Un graphe relie les temps qui se ressemblent (accords + timbre, sur deux mesures). Ses vecteurs propres, regroupés par k-means, donnent une lettre par passage : même lettre = même musique. Le nombre de groupes est choisi par morceau, le plus grand qui ne hache pas les sections. Chaque frontière est ensuite recalée sur la barre de mesure (± 2 mesures) où l'arrangement et le volume changent le plus.
2. **Refrains** : pour chaque instant, on mesure s'il revient **presque à l'identique** ailleurs dans le morceau. La comparaison se fait toutes les ~90 ms sur l'enveloppe de la bande de la voix (250 Hz – 5 kHz), ses variations et la couleur harmonique, par fenêtres de 4 s. Un couplet reprend la musique avec d'autres paroles, un refrain reprend les mêmes paroles sur la même mélodie. Ce signal sépare refrain et couplet avec une AUC de 0,87, contre 0,62 pour le volume. Les refrains sont les zones au-dessus d'un seuil d'Otsu. Leurs limites sont calées sur la barre de mesure où la répétition démarre ou s'arrête.
3. **Garde-fous** :
   - une répétition nettement moins forte que le refrain le plus fort n'est pas le refrain (couplet chanté deux fois pareil, paire intro/outro) ;
   - une « répétition » qui ouvre le morceau est l'intro, sauf si elle est aussi forte que les autres refrains ;
   - un passage de 4 à 10 mesures, juste avant un refrain et différent du couplet, est un pré-refrain.
4. **Hook** : la fenêtre de 4 mesures qui combine le plus de répétition exacte, d'énergie et de retours. Il peut tomber dans un couplet : l'app indique dans quelle section il se trouve.
5. **Correction manuelle** : sur la page Score, touche une section de la frise pour l'écouter ou changer son type. La durée d'intro, l'écart de volume refrain/couplet et le score se recalculent. « Revenir à la détection » annule les corrections.

## Mesure

Banc d'essai : [JamendoLyrics](https://github.com/f90/jamendolyrics), 79 chansons sous licence Creative Commons (20 anglaises, 19 françaises, 20 allemandes, 20 espagnoles) avec les paroles horodatées ligne par ligne. Référence : une ligne chantée compte comme « refrain » si elle fait partie d'au moins deux lignes consécutives qui reviennent plus loin, sinon comme « couplet ». 70 chansons ont des paroles répétées. Le score est l'exactitude équilibrée sur les passages chantés (0,5 = hasard).

| | Ancien algorithme | Nouveau |
|---|---|---|
| Exactitude équilibrée refrain / couplet | 0,640 | **0,828** |
| Premier refrain trouvé | 22 / 70 | **53 / 70** |
| Hook posé sur des paroles répétées | 76 % | **98 %** |
| Français : exactitude / premier refrain | 0,651 / 5 sur 15 | **0,796 / 9 sur 15** |

Temps de calcul : environ 0,5 s de plus par morceau (5 s au total pour un titre de 2 min 38 dans Chromium, décodage compris).

Reproduire (Python + `soundfile` pour décoder les mp3) :

```bash
git clone https://github.com/f90/jamendolyrics
cd web
JAMENDO_DIR=../jamendolyrics npm run eval:structure   # rapport dans scripts/eval-structure/.cache/report.txt
```

## Limites

- La référence vient des paroles : un pré-refrain dont les paroles se répètent compte comme « refrain ». L'app, elle, l'appelle pré-refrain quand la musique le distingue.
- Quand presque tout se répète (chansons très bouclées, hooks de rap toutes les 8 mesures), la frontière refrain / couplet devient floue.
- Le détecteur de voix (utilisé pour l'intro et les breaks) reste approximatif. Pour une précision maximale sur la voix, sépare d'abord le stem voix (page Stems).
