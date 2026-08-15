# Intégration Gladys — Network UPS Tools (NUT)

Cette intégration externe permet à [Gladys Assistant](https://gladysassistant.com) de détecter les onduleurs exposés par un serveur [Network UPS Tools](https://networkupstools.org/) (`upsd`) et d’enregistrer leurs informations dans Gladys.

> L’intégration est **en lecture seule**. Elle n’envoie aucune commande de mise hors tension, de redémarrage ou de modification de configuration à vos onduleurs.

## Fonctionnalités

Au démarrage et à chaque demande de scan, l’intégration exécute `LIST UPS` sur le serveur NUT configuré. Elle crée ensuite un appareil Gladys par onduleur détecté, avec uniquement les fonctionnalités dont les variables sont effectivement disponibles sur le matériel.

| Famille             | Variables NUT exploitées                                                      | Type dans Gladys         |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| Batterie            | `battery.charge`, `battery.runtime`, `battery.voltage`, `battery.temperature` | Niveau, durée et mesures |
| Charge et puissance | `ups.load`, `ups.realpower`, `ups.power`                                      | Pourcentage, W et VA     |
| Électricité         | `input.voltage`, `output.voltage`, `input.current`, `output.current`          | V et A                   |
| Température         | `ups.temperature`                                                             | °C                       |

Les valeurs sont actualisées via `LIST VAR <upsname>` à la fréquence configurée. Les onduleurs et les fonctionnalités sont découverts dynamiquement, ce qui permet de prendre en charge plusieurs modèles et plusieurs pilotes NUT sans configuration manuelle d’identifiants matériels.

## Configuration dans Gladys

Dans la page de configuration de l’intégration, configurez jusqu’à **cinq serveurs `upsd`**. Le premier serveur est obligatoire ; les quatre suivants sont facultatifs. Pour chaque serveur, renseignez l’hôte, le port TCP — **3493** par défaut — et, si nécessaire, les identifiants NUT. Choisissez ensuite un intervalle de rafraîchissement compris entre 30 et 3 600 secondes. Tous les onduleurs de tous les serveurs configurés sont découverts séparément.

Gladys ne sait interroger un appareil qu’aux fréquences de son propre planificateur, la plus lente étant d’une minute. Chaque onduleur est donc enregistré sur la fréquence de scrutation la plus proche — 30 secondes ou 1 minute — et l’intégration ignore elle-même les scrutations qui tombent à l’intérieur de l’intervalle configuré. Un intervalle plus long qu’une minute est appliqué au tick de scrutation le plus proche.

Le bouton **Tester la connexion NUT** vérifie l’accès au serveur et affiche le nombre d’onduleurs détectés. En cas d’échec, l’état de connexion de l’intégration explique l’erreur remontée par le serveur ou le réseau.

Le serveur NUT doit autoriser les connexions provenant de l’environnement Gladys. Consultez la [spécification réseau NUT](https://networkupstools.org/docs/developer-guide.chunked/net-protocol.html) et votre configuration `upsd.conf` / `upsd.users` pour adapter les droits et les ACL à votre installation.

## Architecture

```text
Gladys ── SDK WebSocket ── intégration gladys-nut ── TCP 3493 ── NUT upsd ── onduleur(s)
```

Le client TCP interne est volontairement limité aux commandes NUT de lecture `LIST UPS` et `LIST VAR`. Il ouvre une connexion courte par requête, gère les réponses multi-lignes ainsi que l’authentification facultative `USERNAME` / `PASSWORD`, puis publie les mesures numériques confirmées par le serveur NUT. Les fonctionnalités textuelles sont volontairement omises pour rester compatibles avec les versions de Gladys Core antérieures à la prise en charge de la catégorie `text`.

Chaque fonctionnalité publiée déclare ses bornes `min` et `max` : Gladys Core stocke ces deux colonnes en `NOT NULL` et refuse l’enregistrement de l’appareil avec une erreur HTTP 422 lorsqu’elles manquent. Ces bornes sont uniquement descriptives — elles dimensionnent les jauges et les graphiques — et aucune mesure hors de cet intervalle n’est rejetée ni tronquée.

## Développement local

```bash
npm ci
npm run format:check
npm run lint
npm test
```

Pour lancer l’intégration hors de Gladys, configurez les variables d’environnement injectées normalement par le superviseur :

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="nut" \
LOG_LEVEL=debug \
npm start
```

Les tests unitaires couvrent la validation de configuration, l’analyse des réponses du protocole NUT, l’authentification facultative, la découverte multi-onduleurs, la validité du payload de découverte (bornes des fonctionnalités, fréquence de scrutation) et le mapping des mesures vers Gladys.

## Validation et publication

Avant publication, exécutez le validateur du catalogue Gladys :

```bash
npx github:GladysAssistant/integration-store .
```

Ajoutez ensuite le sujet GitHub `gladys-assistant-integration`, puis utilisez le workflow de release fourni par le template pour construire l’image multi-architecture et publier une version.

## Licence

[Apache-2.0](./LICENSE)
