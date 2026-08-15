# Network UPS Tools (NUT)

L’intégration **Network UPS Tools (NUT)** permet à Gladys de récupérer les mesures et états des onduleurs déclarés dans un serveur NUT `upsd` accessible sur votre réseau local.

> L’intégration est conçue pour la supervision. Elle ne commande pas l’arrêt, le redémarrage ni les réglages des onduleurs.

## Prérequis

Votre onduleur doit déjà être fonctionnel dans NUT. Depuis la machine qui héberge Gladys, le serveur doit répondre à la commande suivante, en remplaçant les valeurs par celles de votre installation :

```bash
upsc <nom-onduleur>@<adresse-serveur>
```

Par défaut, `upsd` écoute en TCP sur le port **3493**. Vérifiez également que les règles réseau et les ACL NUT autorisent l’accès depuis Gladys.

## Configuration

1. Ouvrez **Intégrations**, puis l’intégration **Network UPS Tools (NUT)**.
2. Dans l’onglet **Configuration**, renseignez le premier serveur `upsd` ; son hôte est obligatoire.
3. Ajoutez si nécessaire jusqu’à quatre serveurs supplémentaires dans les emplacements optionnels.
4. Pour chaque serveur, laissez le port à `3493` sauf si votre installation utilise un autre port. Renseignez aussi les identifiants NUT si une authentification est requise.
5. Choisissez l’intervalle de rafraîchissement. La valeur par défaut de 60 secondes convient à la plupart des installations.
6. Enregistrez, puis utilisez **Tester les connexions NUT**.

Une fois la connexion validée, Gladys découvre tous les onduleurs retournés par le serveur NUT. Chaque onduleur apparaît comme un appareil distinct dans la découverte Gladys. Dans l’onglet **Découverte**, cliquez sur **Ajouter** pour chaque onduleur que vous souhaitez intégrer : vous pouvez en ajouter plusieurs, indépendamment les uns des autres. La liste est reconstruite à chaque scan à partir de la commande NUT `LIST UPS`.

## Informations disponibles

Les pilotes NUT ne renvoient pas tous les mêmes variables. L’intégration crée donc seulement les capteurs correspondant aux informations réellement publiées par l’onduleur.

| Domaine      | Variables possibles                                  |
| ------------ | ---------------------------------------------------- |
| Batterie     | Charge, autonomie, tension et température            |
| Alimentation | Tension et courant d’entrée/sortie                   |
| Charge       | Charge en pourcentage, puissance réelle et apparente |
| Onduleur     | Température, statut et alarmes                       |

Les mesures sont publiées uniquement lorsqu’elles sont numériques et effectivement retournées par le pilote. Les statuts textuels NUT sont lus pendant la communication mais ne sont pas publiés comme fonctionnalités Gladys afin de rester compatibles avec les versions Core qui ne reconnaissent pas encore la catégorie `text`.

## Dépannage

| Symptôme                             | Vérifications recommandées                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Aucun onduleur détecté               | Vérifiez chaque hôte, port, pare-feu et la présence d’au moins un onduleur dans chaque `ups.conf`.                  |
| Erreur d’accès ou d’authentification | Vérifiez les ACL dans `upsd.conf` et les identifiants définis dans `upsd.users`.                                    |
| Certaines mesures manquent           | Exécutez `upsc <nom>@<serveur>` ; seules les variables retournées par votre pilote peuvent être créées dans Gladys. |
| Données obsolètes                    | Vérifiez que le pilote NUT communique encore avec le matériel et consultez les logs `upsd`.                         |

Pour obtenir les détails de l’erreur, ouvrez les journaux de l’intégration dans Gladys. Vous pouvez également régler `LOG_LEVEL=debug` pour disposer de logs plus détaillés.

## Ressources

La [spécification officielle du protocole réseau NUT](https://networkupstools.org/docs/developer-guide.chunked/net-protocol.html) détaille les commandes de découverte et de lecture utilisées par l’intégration.
