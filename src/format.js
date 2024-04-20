import Base64 from 'crypto-js/enc-base64';
import { wordsToBytes } from './crypto.js';
import * as Protobufs from './protobufs.js';
import { stringify as yamlStringify } from 'yaml';

export function time(v) {
    const t = new Date(v * 1000);
    return t.toISOString();
}

export function hex(v, width) {
    return v.toString(16).padStart(width, '0');
}

export function id(v) {
    return hex(v, 8);
}

export function nodeId(v) {
    return '!' + hex(v, 8);
}

export function float(v) {
    const n = new Number(v);
    return n.toFixed(2);
}

export function coord(v) {
    return v / 10000000;
}

export function route(v) {
    const route = [];
    v.forEach((r) => {
        route.push(nodeId(r));
    });
    return route;
}

export function macaddr(v) {
    const words = Base64.parse(v);
    const bytes = wordsToBytes(words);
    return Array.from(bytes).map((v) => hex(v, 2)).join(':');
}

export function payload(v) {
    const words = Base64.parse(v);
    const bytes = wordsToBytes(words);
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
    [Protobufs.Portnums.PortNum.TEXT_MESSAGE_APP,  Text                                  ],
    [Protobufs.Portnums.PortNum.POSITION_APP,      Protobufs.Mesh.Position               ],
    [Protobufs.Portnums.PortNum.NODEINFO_APP,      Protobufs.Mesh.User                   ],
    [Protobufs.Portnums.PortNum.ROUTING_APP,       Protobufs.Mesh.Routing                ],
    [Protobufs.Portnums.PortNum.STORE_FORWARD_APP, Protobufs.StoreForward.StoreAndForward],
    [Protobufs.Portnums.PortNum.TELEMETRY_APP,     Protobufs.Telemetry.Telemetry         ],
    [Protobufs.Portnums.PortNum.TRACEROUTE_APP,    Protobufs.Mesh.RouteDiscovery         ],
    [Protobufs.Portnums.PortNum.NEIGHBORINFO_APP,  Protobufs.Mesh.NeighborInfo           ],
]);

export const Result = {
    Ok:  0,
    Err: 1,
    NYI: 2,
};

export function parseDecoded(data) {
    const typ = parsers.get(data.portnum);
    if (typ === undefined) {
        return {
            status: Result.NYI,
        };
    }
    try {
        const replacer = (k, v) => {
            const formatter = formatters.get(k);
            return formatter ? formatter(v) : v;
        };
        const dataText = yamlStringify(data.toJson(), replacer)
            .replace(/\n+$/gm, '')
            .replace(/^/gm, '  ');
        const message = typ.fromBinary(data.payload);
        const messageText = yamlStringify(message.toJson(), replacer)
            .replace(/\n+$/gm, '')
            .replace(/^/gm, '  ');
        return {
            status: Result.Ok,
            value: {
                message: message,
                text: `Data:\n${dataText}\n${typ.name}:\n${messageText}`,
            },
        };
    } catch (error) {
        return {
            status: Result.Err,
            error: error
        };
    }
}
