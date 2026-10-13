# Network UPS Tools (NUT)

La integración **Network UPS Tools (NUT)** permite a Gladys obtener valores y estados de los SAI expuestos por un servidor NUT `upsd` accesible en la red local.

> Esta integración está pensada para la supervisión. No envía comandos de apagado, reinicio ni configuración a los SAI.

## Requisitos previos

Tu SAI ya debe funcionar en NUT. Desde la máquina que aloja Gladys, el servidor NUT debería responder al siguiente comando, tras sustituir los marcadores por tus propios valores:

```bash
upsc <ups-name>@<server-address>
```

Por defecto, `upsd` escucha en el puerto TCP **3493**. Asegúrate de que tanto las reglas de red como las ACL de NUT permiten el acceso desde Gladys.

### Las credenciales viajan en texto plano

La integración no utiliza TLS (`STARTTLS`): el usuario y la contraseña de NUT, así como todas las mediciones, atraviesan la red en texto plano. Mantenla en una red de confianza:

- haz que `upsd` escuche solo en la interfaz por la que lo alcanza Gladys (`LISTEN` en `upsd.conf`) y filtra el puerto 3493 para que solo el host de Gladys pueda conectarse;
- crea en `upsd.users` un usuario dedicado para Gladys, sin `actions` ni `instcmds`: la integración solo lee, así que nunca los necesita;
- no reutilices nunca esa contraseña en otro sitio.

## Configuración

1. Abre **Integraciones** y luego **Network UPS Tools (NUT)**.
2. En la pestaña **Configuración**, introduce el primer servidor `upsd`; su host es obligatorio.
3. Añade hasta cuatro servidores adicionales en los campos opcionales si lo necesitas.
4. Para cada servidor, mantén el puerto `3493` salvo que tu instalación use otro. Introduce las credenciales de NUT si se requiere autenticación.
5. Elige un intervalo de actualización. El valor predeterminado de 300 segundos es adecuado para la mayoría de las instalaciones. Gladys consulta los dispositivos como mucho una vez por minuto: un intervalo más largo se aplica en la consulta más cercana.
6. Guarda y luego usa **Probar las conexiones NUT**.

### Elegir el intervalo de actualización

Cada valor publicado se conserva en el historial de Gladys, y un SAI expone hasta doce valores. Un intervalo corto hace crecer rápidamente la base de datos: a 60 segundos, un solo SAI escribe unas 17 000 filas al día, frente a unas 3500 con el intervalo predeterminado de 300 segundos.

Para reducir aún más ese volumen, la integración solo publica los valores que han cambiado desde la medición anterior; un valor que se mantiene estable se vuelve a publicar al menos una vez por hora para que nunca aparezca como obsoleto. Baja a 60 segundos solo si necesitas una supervisión fina —la autonomía restante durante un corte, por ejemplo— y sube el intervalo hasta 86 400 segundos si prefieres cuidar la base de datos.

Una vez establecida la conexión, Gladys detecta todos los SAI que devuelve el servidor NUT. Cada SAI aparece en la detección como un dispositivo Gladys distinto. En la pestaña **Detección**, haz clic en **Añadir** en cada SAI que quieras integrar: puedes añadir varios dispositivos de forma independiente. La lista se reconstruye en cada escaneo a partir del comando NUT `LIST UPS`.

## Información disponible

No todos los controladores NUT informan de las mismas variables, así que la integración solo crea sensores para la información que cada SAI proporciona realmente.

| Ámbito    | Valores posibles                                         |
| --------- | -------------------------------------------------------- |
| Batería   | Carga, autonomía, tensión y temperatura                  |
| Corriente | Tensión y corriente de entrada/salida                    |
| Carga     | Porcentaje de carga, potencia activa y potencia aparente |
| SAI       | Temperatura, estado y alarmas                            |

Los valores solo se publican cuando son numéricos y el controlador los informa realmente. Los estados de texto de NUT se leen durante la comunicación, pero no se publican como funciones de Gladys, para que los datos de detección sigan siendo compatibles con las versiones del Core que aún no reconocen la categoría `text`.

## Widget, escenas y acciones (Gladys 5.1)

La integración requiere **Gladys 5.1 o posterior**.

### Widget «SAI»

En **Panel → Editar → Añadir un widget**, elige **SAI** y luego el SAI que quieres mostrar. El widget muestra:

- la carga de la batería (indicador) y la autonomía restante;
- la carga del SAI y la tensión de entrada;
- un gráfico de 24 h (carga de la batería y carga del SAI);
- el estado (con red eléctrica, con batería, batería baja…), las alarmas de NUT, la potencia y el servidor;
- un botón **Actualizar**, que lee el SAI al instante. Nunca envía un comando al SAI.

El widget muestra la última medición realizada por la integración (de 3 minutos como máximo). Cuando el SAI tarda en responder, muestra «Leyendo el SAI…» y se actualiza unos segundos después.

### Disparadores de escena

En el editor de escenas, categoría **Integraciones**:

| Disparador                           | Cuándo                                     |
| ------------------------------------ | ------------------------------------------ |
| SAI: corte de corriente, con batería | el SAI pasa a funcionar con batería (`OB`) |
| SAI: corriente restablecida          | el SAI vuelve a la red eléctrica (`OL`)    |
| SAI: batería baja                    | NUT informa de una batería baja (`LB`)     |
| SAI: sustituir la batería            | NUT pide una sustitución (`RB`)            |

- Deja vacío el campo **SAI** para reaccionar a todos los SAI.
- El estado se comprueba **cada minuto**, sea cual sea el intervalo de actualización: un corte de corriente se detecta en menos de un minuto.
- Variables disponibles en la escena: `ups_name`, `status`, `battery_charge` (%), `battery_runtime` (min), `load` (%).
- Al iniciarse la integración, la primera medición sirve de referencia: no se envía ningún evento para un SAI que ya funciona con batería.

### Acción de escena «Leer el estado de un SAI»

Lee el SAI elegido y devuelve a las acciones siguientes: `ups_name`, `status` (`online`, `on_battery`, `low_battery`, `forced_shutdown`, `off`, `bypass`, `unknown`), `on_battery`, `low_battery`, `replace_battery`, `battery_charge`, `battery_runtime` (min), `load`, `input_voltage`. Una medición de la que el SAI no informa se omite.

Ejemplo: cada mañana, leer el estado del SAI y luego enviar un mensaje con la autonomía restante.

## Solución de problemas

| Síntoma                                                                         | Comprobaciones recomendadas                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No se encuentra ningún SAI                                                      | Comprueba cada host, cada puerto, el cortafuegos y que haya al menos un SAI configurado en cada `ups.conf`.                                                                                                                                                 |
| Error de acceso o de autenticación                                              | Comprueba las ACL de `upsd.conf` y las credenciales definidas en `upsd.users`.                                                                                                                                                                              |
| Faltan algunos valores                                                          | Ejecuta `upsc <ups>@<server>`; Gladys solo puede crear las variables que expone tu controlador NUT.                                                                                                                                                         |
| Datos obsoletos                                                                 | Un valor estable solo se reescribe una vez por hora, lo cual es normal. Más allá de eso, verifica que el controlador NUT sigue comunicándose con el hardware y revisa los registros de `upsd`.                                                              |
| La base de datos de Gladys crece demasiado rápido                               | Aumenta el intervalo de actualización: el volumen del historial es directamente proporcional a él. Cada SAI que añades escribe su propio historial.                                                                                                         |
| Añadir un SAI falla con «dispositivo incompleto o no válido»                    | Actualiza la integración. Ese rechazo (HTTP 422) se debía a funciones publicadas sin sus límites `min` y `max`, que ahora siempre se declaran.                                                                                                              |
| Los valores no cambian nunca tras añadir el dispositivo                         | Actualiza la integración: los dispositivos se publican ahora con la consulta periódica activada.                                                                                                                                                            |
| Algunas funciones se muestran sin nombre ni icono                               | Actualiza la integración y luego vuelve a añadir el SAI desde la pestaña **Detección** para que se actualicen sus funciones existentes: la carga y la potencia aparente se publicaban con un par categoría/tipo que el front-end de Gladys no sabe dibujar. |
| El estado de conexión dice «Conectado, pero 1 de 2 servidores NUT no responden» | Los SAI de los demás servidores se siguen leyendo. Comprueba el servidor indicado (host, puerto, cortafuegos, `upsd` en marcha); el estado vuelve a ser simplemente «conectado» en su siguiente respuesta.                                                  |
| Un SAI dejó de actualizarse tras quitar un servidor de la configuración         | Su servidor ya no se consulta, y los registros lo indican una vez. Vuelve a añadir el servidor o elimina el dispositivo en Gladys.                                                                                                                          |
| La carga del SAI se muestra como «Desconocido»                                  | Actualiza la integración y luego vuelve a añadir el SAI desde la pestaña **Detección**: la carga (`ups.load`) se publica ahora en una categoría que permite a Gladys mostrar su nombre, «Carga».                                                            |

Para ver los errores detallados, abre los registros de la integración en Gladys. También puedes definir `LOG_LEVEL=debug` para obtener registros más detallados.

## Recursos

La [especificación oficial del protocolo de red de NUT](https://networkupstools.org/docs/developer-guide.chunked/net-protocol.html) detalla los comandos de detección y de lectura que utiliza esta integración.
