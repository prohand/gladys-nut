# Network UPS Tools (NUT)

The **Network UPS Tools (NUT)** integration lets Gladys retrieve values and states from UPS devices exposed by a reachable NUT `upsd` server on the local network.

> This integration is designed for monitoring. It does not send shutdown, restart, or configuration commands to UPS devices.

## Prerequisites

Your UPS must already work in NUT. From the machine hosting Gladys, the NUT server should answer the following command, after replacing the placeholders with your own values:

```bash
upsc <ups-name>@<server-address>
```

By default, `upsd` listens on TCP port **3493**. Ensure that both network rules and NUT ACLs allow access from Gladys.

## Configuration

1. Open **Integrations**, then **Network UPS Tools (NUT)**.
2. In the **Configuration** tab, enter the first `upsd` server; its host is required.
3. Add up to four additional servers in the optional slots when needed.
4. For each server, keep port `3493` unless your installation uses another port. Enter NUT credentials when authentication is required.
5. Choose a refresh interval. The default value of 60 seconds is appropriate for most installations.
6. Save, then use **Test NUT connections**.

Once the connection succeeds, Gladys discovers every UPS returned by the NUT server. Each UPS appears as a distinct Gladys device in discovery. In the **Discovery** tab, click **Add** for every UPS you want to integrate: you can add several devices independently. The list is rebuilt on each scan from the NUT `LIST UPS` command.

## Available information

NUT drivers do not all report the same variables, so the integration only creates sensors for information actually provided by each UPS.

| Domain  | Possible values                                 |
| ------- | ----------------------------------------------- |
| Battery | Charge, runtime, voltage, and temperature       |
| Power   | Input/output voltage and current                |
| Load    | Load percentage, real power, and apparent power |
| UPS     | Temperature, status, and alarms                 |

Values are published only when they are numeric and actually reported by the driver. NUT text statuses are read during communication but are not published as Gladys features, keeping the discovery payload compatible with Core versions that do not yet recognize the `text` category.

## Troubleshooting

| Symptom                        | Recommended checks                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| No UPS is found                | Check every host, port, firewall, and that at least one UPS is configured in each `ups.conf`. |
| Access or authentication error | Check the ACLs in `upsd.conf` and credentials defined in `upsd.users`.                        |
| Some values are missing        | Run `upsc <ups>@<server>`; Gladys can only create variables exposed by your NUT driver.       |
| Stale data                     | Verify that the NUT driver still communicates with the hardware and inspect the `upsd` logs.  |

For detailed errors, open the integration logs in Gladys. You can also set `LOG_LEVEL=debug` for more detailed logs.

## Resources

The [official NUT network protocol specification](https://networkupstools.org/docs/developer-guide.chunked/net-protocol.html) details the discovery and read commands used by this integration.
