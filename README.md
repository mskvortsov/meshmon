# Meshtastic MQTT Monitor

A web browser application that shows meshtastic packet data acquired from an MQTT broker.
The broker must have a secure WebSocket endpoint. There is no server backend — everything
runs in a browser.

The app is deployed at <https://mskvortsov.github.io/meshmon>

## Running locally

```shell
npm ci
npm run test
npm run dev
```
