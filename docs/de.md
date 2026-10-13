# Network UPS Tools (NUT)

Mit der Integration **Network UPS Tools (NUT)** ruft Gladys Werte und Zustände von USV-Geräten ab, die ein im lokalen Netzwerk erreichbarer NUT-Server `upsd` bereitstellt.

> Diese Integration dient der Überwachung. Sie sendet keine Befehle zum Herunterfahren, Neustarten oder Konfigurieren an die USV-Geräte.

## Voraussetzungen

Ihre USV muss bereits in NUT funktionieren. Von dem Rechner aus, auf dem Gladys läuft, sollte der NUT-Server auf den folgenden Befehl antworten, nachdem Sie die Platzhalter durch Ihre eigenen Werte ersetzt haben:

```bash
upsc <ups-name>@<server-address>
```

Standardmäßig lauscht `upsd` auf dem TCP-Port **3493**. Stellen Sie sicher, dass sowohl die Netzwerkregeln als auch die NUT-ACLs den Zugriff von Gladys erlauben.

### Zugangsdaten werden im Klartext übertragen

Die Integration verwendet kein TLS (`STARTTLS`): Der NUT-Benutzername und das Passwort sowie alle Messwerte gehen im Klartext über das Netzwerk. Betreiben Sie sie daher in einem vertrauenswürdigen Netzwerk:

- lassen Sie `upsd` nur auf der Schnittstelle lauschen, über die Gladys ihn erreicht (`LISTEN` in `upsd.conf`), und filtern Sie den Port 3493, sodass sich nur der Gladys-Host verbinden kann;
- legen Sie in `upsd.users` einen eigenen Benutzer für Gladys an, ohne `actions` und ohne `instcmds`: Die Integration liest nur und braucht sie daher nie;
- verwenden Sie dieses Passwort nirgendwo sonst.

## Konfiguration

1. Öffnen Sie **Integrationen** und dann **Network UPS Tools (NUT)**.
2. Tragen Sie im Tab **Konfiguration** den ersten `upsd`-Server ein; sein Host ist erforderlich.
3. Fügen Sie bei Bedarf in den optionalen Feldern bis zu vier weitere Server hinzu.
4. Behalten Sie für jeden Server den Port `3493` bei, sofern Ihre Installation keinen anderen Port verwendet. Geben Sie NUT-Zugangsdaten ein, wenn eine Authentifizierung erforderlich ist.
5. Wählen Sie ein Aktualisierungsintervall. Der Standardwert von 300 Sekunden passt für die meisten Installationen. Gladys fragt Geräte höchstens einmal pro Minute ab: Ein längeres Intervall wird beim nächstgelegenen Abfragezeitpunkt angewendet.
6. Speichern Sie und verwenden Sie dann **NUT-Verbindungen testen**.

### Das Aktualisierungsintervall wählen

Jeder veröffentlichte Wert wird im Gladys-Verlauf gespeichert, und eine USV stellt bis zu zwölf Werte bereit. Ein kurzes Intervall lässt die Datenbank daher schnell wachsen: Bei 60 Sekunden schreibt eine einzelne USV rund 17.000 Zeilen pro Tag, beim Standardintervall von 300 Sekunden rund 3.500.

Um dieses Volumen weiter zu verringern, veröffentlicht die Integration nur die Werte, die sich seit der vorherigen Messung geändert haben; ein stabil gebliebener Wert wird mindestens einmal pro Stunde erneut veröffentlicht, damit er nie als veraltet angezeigt wird. Gehen Sie nur dann auf 60 Sekunden herunter, wenn Sie eine feine Überwachung benötigen – etwa der Restlaufzeit während eines Stromausfalls –, und erhöhen Sie das Intervall auf bis zu 86.400 Sekunden, wenn Sie die Datenbank lieber schonen möchten.

Sobald die Verbindung steht, erkennt Gladys jede USV, die der NUT-Server meldet. Jede USV erscheint in der Erkennung als eigenes Gladys-Gerät. Klicken Sie im Tab **Erkennung** bei jeder USV, die Sie einbinden möchten, auf **Hinzufügen**: Sie können mehrere Geräte unabhängig voneinander hinzufügen. Die Liste wird bei jedem Scan aus dem NUT-Befehl `LIST UPS` neu aufgebaut.

## Verfügbare Informationen

NUT-Treiber melden nicht alle dieselben Variablen, daher legt die Integration nur Sensoren für Informationen an, die die jeweilige USV tatsächlich liefert.

| Bereich  | Mögliche Werte                                   |
| -------- | ------------------------------------------------ |
| Batterie | Ladung, Restlaufzeit, Spannung und Temperatur    |
| Strom    | Eingangs-/Ausgangsspannung und -strom            |
| Last     | Lastprozentsatz, Wirkleistung und Scheinleistung |
| USV      | Temperatur, Status und Alarme                    |

Werte werden nur veröffentlicht, wenn sie numerisch sind und vom Treiber tatsächlich gemeldet werden. Die Textstatus von NUT werden bei der Kommunikation gelesen, aber nicht als Gladys-Funktionen veröffentlicht. So bleibt die Erkennungsnutzlast mit Core-Versionen kompatibel, die die Kategorie `text` noch nicht kennen.

## Widget, Szenen und Aktionen (Gladys 5.1)

Die Integration erfordert **Gladys 5.1 oder neuer**.

### Widget „USV“

Wählen Sie unter **Dashboard → Bearbeiten → Widget hinzufügen** das Widget **USV** und anschließend die anzuzeigende USV. Das Widget zeigt:

- die Batterieladung (Anzeige) und die Restlaufzeit;
- die USV-Last und die Eingangsspannung;
- ein 24-Stunden-Diagramm (Batterieladung und Last);
- den Status (Netzbetrieb, Batteriebetrieb, Batterie schwach …), die NUT-Alarme, die Leistung und den Server;
- eine Schaltfläche **Aktualisieren**, die die USV sofort liest. Sie sendet niemals einen Befehl an die USV.

Das Widget zeigt die letzte Messung der Integration (höchstens 3 Minuten alt). Antwortet die USV langsam, zeigt es „USV wird gelesen …“ und aktualisiert sich wenige Sekunden später.

### Szenen-Auslöser

Im Szenen-Editor, Kategorie **Integrationen**:

| Auslöser                           | Wann                                           |
| ---------------------------------- | ---------------------------------------------- |
| USV: Stromausfall, Batteriebetrieb | die USV wechselt in den Batteriebetrieb (`OB`) |
| USV: Netzstrom wiederhergestellt   | die USV ist wieder am Netz (`OL`)              |
| USV: Batterie schwach              | NUT meldet eine schwache Batterie (`LB`)       |
| USV: Batterie austauschen          | NUT verlangt einen Austausch (`RB`)            |

- Lassen Sie das Feld **USV** leer, um auf jede USV zu reagieren.
- Der Status wird unabhängig vom Aktualisierungsintervall **jede Minute** geprüft: Ein Stromausfall wird innerhalb einer Minute erkannt.
- In der Szene verfügbare Variablen: `ups_name`, `status`, `battery_charge` (%), `battery_runtime` (min), `load` (%).
- Beim Start der Integration dient die erste Messung als Referenz: Für eine USV, die bereits im Batteriebetrieb ist, wird kein Ereignis gesendet.

### Szenen-Aktion „Status einer USV lesen“

Sie liest die gewählte USV und gibt an die folgenden Aktionen zurück: `ups_name`, `status` (`online`, `on_battery`, `low_battery`, `forced_shutdown`, `off`, `bypass`, `unknown`), `on_battery`, `low_battery`, `replace_battery`, `battery_charge`, `battery_runtime` (min), `load`, `input_voltage`. Ein Messwert, den die USV nicht meldet, wird weggelassen.

Beispiel: Jeden Morgen den USV-Status lesen und dann eine Nachricht mit der Restlaufzeit senden.

## Fehlerbehebung

| Symptom                                                                                        | Empfohlene Prüfungen                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Es wird keine USV gefunden                                                                     | Prüfen Sie jeden Host, jeden Port, die Firewall und ob in jeder `ups.conf` mindestens eine USV konfiguriert ist.                                                                                                                                                                        |
| Zugriffs- oder Authentifizierungsfehler                                                        | Prüfen Sie die ACLs in `upsd.conf` und die in `upsd.users` definierten Zugangsdaten.                                                                                                                                                                                                    |
| Einige Werte fehlen                                                                            | Führen Sie `upsc <ups>@<server>` aus; Gladys kann nur Variablen anlegen, die Ihr NUT-Treiber bereitstellt.                                                                                                                                                                              |
| Veraltete Daten                                                                                | Ein stabiler Wert wird nur einmal pro Stunde neu geschrieben, das ist normal. Prüfen Sie darüber hinaus, ob der NUT-Treiber noch mit der Hardware kommuniziert, und sehen Sie sich die `upsd`-Protokolle an.                                                                            |
| Die Gladys-Datenbank wächst zu schnell                                                         | Erhöhen Sie das Aktualisierungsintervall: Die Menge des Verlaufs ist direkt proportional dazu. Jede hinzugefügte USV schreibt ihren eigenen Verlauf.                                                                                                                                    |
| Das Hinzufügen einer USV scheitert mit „unvollständiges oder ungültiges Gerät“                 | Aktualisieren Sie die Integration. Diese Ablehnung (HTTP 422) kam von Funktionen, die ohne ihre Grenzen `min` und `max` veröffentlicht wurden; diese werden jetzt immer angegeben.                                                                                                      |
| Die Werte ändern sich nach dem Hinzufügen des Geräts nie                                       | Aktualisieren Sie die Integration: Geräte werden jetzt mit aktivierter periodischer Abfrage veröffentlicht.                                                                                                                                                                             |
| Einige Funktionen werden ohne Namen oder Symbol angezeigt                                      | Aktualisieren Sie die Integration und fügen Sie die USV dann erneut über den Tab **Erkennung** hinzu, damit ihre bestehenden Funktionen aktualisiert werden: Last und Scheinleistung wurden mit einem Kategorie/Typ-Paar veröffentlicht, das das Gladys-Frontend nicht darstellen kann. |
| Der Verbindungsstatus lautet „Verbunden, aber 1 von 2 NUT-Servern antworten nicht“             | Die USV der anderen Server werden weiterhin gelesen. Prüfen Sie den genannten Server (Host, Port, Firewall, läuft `upsd`); der Status kehrt bei seiner nächsten Antwort zu einfachem „verbunden“ zurück.                                                                                |
| Eine USV wird nicht mehr aktualisiert, nachdem ein Server aus der Konfiguration entfernt wurde | Ihr Server wird nicht mehr abgefragt, was die Protokolle einmal melden. Fügen Sie den Server wieder hinzu oder löschen Sie das Gerät in Gladys.                                                                                                                                         |
| Die USV-Last wird als „Unbekannt“ angezeigt                                                    | Aktualisieren Sie die Integration und fügen Sie die USV dann erneut über den Tab **Erkennung** hinzu: Die Last (`ups.load`) wird jetzt in einer Kategorie veröffentlicht, mit der Gladys ihren Namen „Last“ anzeigen kann.                                                              |

Ausführliche Fehler finden Sie in den Protokollen der Integration in Gladys. Sie können auch `LOG_LEVEL=debug` setzen, um detailliertere Protokolle zu erhalten.

## Ressourcen

Die [offizielle Spezifikation des NUT-Netzwerkprotokolls](https://networkupstools.org/docs/developer-guide.chunked/net-protocol.html) beschreibt die Erkennungs- und Lesebefehle, die diese Integration verwendet.
