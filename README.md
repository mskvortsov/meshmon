# Meshtastic MQTT Monitor

A pure JavaScript application (no server backend used) that shows raw packet
data acquired from a specified MQTT server. The server should have a WebSocket
endpoint.

Nodes should publish their packets in protobuf form by disabling JSON output
in MQTT settings.

The app is deployed at <https://mskvortsov.github.io/meshmon>

## Running locally

```shell
npm ci
npm run generate
npm run dev
```
