import Base64 from 'crypto-js/enc-base64';
import * as Crypto from './crypto.js';
import * as Protobufs from './protobufs.js';
import { stringify as yamlStringify } from 'yaml';

export function hex(v, width) {
  return v.toString(16).padStart(width, '0');
}

function time(v) {
  const t = new Date(v * 1000);
  return t.toISOString();
}

function id(v) {
  return hex(v, 8);
}

function nodeId(v) {
  return '!' + hex(v, 8);
}

function float(v) {
  const n = new Number(v);
  return n.toFixed(2);
}

function coord(v) {
  return v / 10000000;
}

function route(v) {
  const route = [];
  v.forEach((r) => {
    route.push(nodeId(r));
  });
  return route;
}

function macaddr(v) {
  const words = Base64.parse(v);
  const bytes = Crypto.wordsToBytes(words);
  return Array.from(bytes).map((v) => hex(v, 2)).join(':');
}

function payload(v) {
  const words = Base64.parse(v);
  const bytes = Crypto.wordsToBytes(words);
  return `x${bytesToString(bytes)}`;
}

const formatters = new Map([
  // Data
  ['payload',            payload],
  ['dest',               nodeId],
  ['source',             nodeId],
  ['replyId',            id],
  ['requestId',          id],
  // Position
  ['latitudeI',          coord],
  ['longitudeI',         coord],
  // NeighborInfo
  ['nodeId',             nodeId],
  ['lastSentById',       nodeId],
  // RouteDiscovery
  ['route',              route],
  // Telemetry
  ['time',               time],
  // DeviceMetrics
  ['voltage',            float],
  ['channelUtilization', float],
  ['airUtilTx',          float],
  // EnvironmentMetrics
  ['temperature',        float],
  ['relativeHumidity',   float],
  ['barometricPressure', float],
  ['gasResistance',      float],
  ['voltage',            float],
  ['current',            float],
  // User
  ['macaddr',            macaddr],
]);

export function bytesToString(arr) {
  return Array.from(arr).map((v) => hex(v, 2)).join('');
}

const Text = {
  name: 'Text',
  fromBinary: (bytes, _options) => {
    return { message: new TextDecoder().decode(bytes) };
  }
};

const parsers = new Map([
  [Protobufs.Portnums.PortNum.TEXT_MESSAGE_APP,  Text],
  [Protobufs.Portnums.PortNum.POSITION_APP,      Protobufs.Mesh.Position],
  [Protobufs.Portnums.PortNum.NODEINFO_APP,      Protobufs.Mesh.User],
  [Protobufs.Portnums.PortNum.ROUTING_APP,       Protobufs.Mesh.Routing],
  [Protobufs.Portnums.PortNum.STORE_FORWARD_APP, Protobufs.StoreForward.StoreAndForward],
  [Protobufs.Portnums.PortNum.TELEMETRY_APP,     Protobufs.Telemetry.Telemetry],
  [Protobufs.Portnums.PortNum.TRACEROUTE_APP,    Protobufs.Mesh.RouteDiscovery],
  [Protobufs.Portnums.PortNum.NEIGHBORINFO_APP,  Protobufs.Mesh.NeighborInfo],
]);

export const Result = {
  Ok:  0,
  Err: 1,
  Nyi: 2,

  ok:  (value) => { return { status: Result.Ok, value: value }; },
  err: (error) => { return { status: Result.Err, error: error }; },
  nyi: ()      => { return { status: Result.Nyi }; },
};

function stringify(json) {
  const replacer = (k, v) => {
    const formatter = formatters.get(k);
    return formatter ? formatter(v) : v;
  };
  return yamlStringify(json, replacer)
    .replace(/\n+$/gm, '')
    .replace(/^/gm, '  ');
}

function parseData(data) {
  const typ = parsers.get(data.portnum);
  if (typ === undefined) {
    return Result.nyi();
  }
  try {
    const dataText = stringify(data.toJson());
    const message = typ.fromBinary(data.payload);
    const messageText = stringify(message.toJson());
    return Result.ok({
      message: message,
      text: `${typ.name}:\n${messageText}`,
    });
  } catch (error) {
    return Result.err(error);
  }
}

export function parse(message) {
  var se;
  try {
    se = Protobufs.Mqtt.ServiceEnvelope.fromBinary(message.payloadBytes);
  } catch (error) {
    return {
      se: Result.err(new Error(
        `Failed to decode ServiceEnvelope: ${error}, ` +
        `Topic: ${message.topic}, ` +
        `Message: x${bytesToString(message.payloadBytes)}`
      )),
    };
  }

  if (se.packet === undefined) {
    return {
      se: Result.err(new Error(
        `Failed to decode ServiceEnvelope: missing packet field`
      )),
    };
  }

  var header;
  try {
    header = {
      time: time(se.packet.rxTime),
      gw:   se.gatewayId,
      ch:   se.channelId,
      id:   id(se.packet.id),
      from: nodeId(se.packet.from),
      to:   nodeId(se.packet.to),
      hs:   se.packet.hopStart,
      hl:   se.packet.hopLimit,
      wa:   se.packet.wantAck ? '1' : '0',
      vm:   se.packet.viaMqtt ? '1' : '0',
      pri:  se.packet.priority,
      rssi: se.packet.rxRssi,
      snr:  se.packet.rxSnr,
      port: '?',
    };
  } catch (error) {
    return {
      se: Result.ok(se),
      header: Result.err(new Error(
        `Failed to decode header: ${error}`
      )),
    };
  }

  var data = se.packet.payloadVariant.value;
  if (se.packet.payloadVariant.case == 'encrypted') {
    try {
      const decrypted = Crypto.decrypt(se.packet, Crypto.defaultKey);
      data = Protobufs.Mesh.Data.fromBinary(decrypted);
    } catch (error) {
      return {
        se: Result.ok(se),
        header: Result.ok(header),
        parsed: Result.err(error),
      };
    }
  }

  if (data === undefined) {
    return {
      se: Result.ok(se),
      header: Result.ok(header),
      parsed: Result.err(new Error('Failed to decode data')),
    };
  }

  header.port = data.portnum;
  const parsed = parseData(data);
  return {
    se: Result.ok(se),
    header: Result.ok(header),
    parsed,
    isUser:
      data.portnum == Protobufs.Portnums.PortNum.NODEINFO_APP &&
      parsed.status == Result.Ok,
  };
}
