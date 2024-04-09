'use strict';

const defaultMqttUrl = 'wss://mqtt.eclipseprojects.io/mqtt';
const defaultMqttTopic = 'marsupial';
const defaultKey = CryptoJS.enc.Base64.parse('1PG7OiApB1nwvP+rz05pAQ==');
const protobufsUrl = 'https://raw.githubusercontent.com/meshtastic/protobufs/v2.3.4';

var mqttUrlInput   = null;
var mqttTopicInput = null;
var mqttConnected  = false;
var mqttClient     = null;

var tbody = null;
var statusRow = null;
var connectButton = null;
var filterInput = null;
var filterExpr = (_h) => { return true; };

function formatTime(v) {
    const t = new Date(v * 1000);
    return t.toISOString();
}

function formatNodeId(v) {
    return '!' + v.toString(16).padStart(8, '0');
}

function formatFloat(v) {
    const n = new Number(v);
    return n.toFixed(2);
}

function formatCoord(v) {
    return v / 10000000;
}

const formatters = new Map([
    ['nodeId',             formatNodeId],
    ['lastSentById',       formatNodeId],
    ['time',               formatTime],
    ['temperature',        formatFloat],
    ['voltage',            formatFloat],
    ['barometricPressure', formatFloat],
    ['relativeHumidity',   formatFloat],
    ['channelUtilization', formatFloat],
    ['airUtilTx',          formatFloat],
    ['latitudeI',          formatCoord],
    ['longitudeI',         formatCoord],
]);

function decodeDefault(proto, name, payload) {
    const info = proto.decode(payload);
    const replacer = (k, v) => {
        const formatter = formatters.get(k);
        if (formatter) {
            return formatter(v);
        } else {
            return v;
        }
    };
    return `${name}\n${JSON.stringify(info, replacer, 2)}`;
};

function decodeText(_proto, name, payload) {
    return `${name}\n${payload.decode('utf-8')}`;
}

function buildMeshtasticProtos() {
    var protobuf_root = new protobuf.Root();
    protobuf_root.resolvePath = function(_origin, target) {
        return `${protobufsUrl}/${target}`;
    };

    const modules = ['meshtastic/mqtt.proto', 'meshtastic/storeforward.proto'];
    var meshtastic = {};

    protobuf_root.load(modules, function(err, root) {
        if (err)
            throw err;

        meshtastic.ServiceEnvelope = root.lookupType('meshtastic.ServiceEnvelope');
        meshtastic.Data            = root.lookupType('meshtastic.Data');
        meshtastic.PortNum         = root.lookupEnum('meshtastic.PortNum');

        const ports = meshtastic.PortNum.values;
        const protos = [
            { port: ports.TEXT_MESSAGE_APP,  name: 'Text',            decode: decodeText },
            { port: ports.POSITION_APP,      name: 'Position',        decode: decodeDefault },
            { port: ports.NODEINFO_APP,      name: 'User',            decode: decodeDefault },
            { port: ports.ROUTING_APP,       name: 'Routing',         decode: decodeDefault },
            { port: ports.STORE_FORWARD_APP, name: 'StoreAndForward', decode: decodeDefault },
            { port: ports.TELEMETRY_APP,     name: 'Telemetry',       decode: decodeDefault },
            { port: ports.TRACEROUTE_APP,    name: 'RouteDiscovery',  decode: decodeDefault },
            { port: ports.NEIGHBORINFO_APP,  name: 'NeighborInfo',    decode: decodeDefault },
        ];

        meshtastic.protos = {};
        protos.forEach((p) => {
            var proto = null;
            try {
                proto = root.lookupType('meshtastic.' + p.name);
            } catch (_error) {
            }
            meshtastic.protos[p.port] = {
                decode: (v) => { return p.decode(proto, p.name, v); },
            };
        });
    });

    return meshtastic;
}

const meshtastic = buildMeshtasticProtos();

function swap32(val) {
    return ((val & 0xff000000) >>> 24)
         | ((val & 0x00ff0000) >>>  8)
         | ((val & 0x0000ff00) <<   8)
         | ((val & 0x000000ff) <<  24);
}

function wordsToByteArray(wordArray) {
    var byteArray = new Uint8Array(wordArray.sigBytes);
    for (var i = 0; i < wordArray.sigBytes; ++i) {
        byteArray[i] = (wordArray.words[i >>> 2] >>> (24 - ((i & 3) << 3))) & 0xff;
    }
    return byteArray;
}

function arrayToString(arr) {
    return arr.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function decodeEncrypted(packet, key) {
    const iv = CryptoJS.lib.WordArray.create([
        swap32(packet.id), 0,
        swap32(packet.from), 0,
    ]);

    const encrypted = CryptoJS.lib.WordArray.create(packet.encrypted);
    const decrypted = CryptoJS.AES.decrypt(
        CryptoJS.lib.CipherParams.create({
            ciphertext: encrypted,
        }),
        key,
        {
            mode: CryptoJS.mode.CTR,
            iv: iv,
            padding: CryptoJS.pad.NoPadding,
        }
    );

    try {
        packet.decoded = meshtastic.Data.decode(wordsToByteArray(decrypted));
    } catch (error) {
        console.log('failed to decode encrypted packet: ' + error);
    }
}

function mqttOnConnect() {
    mqttConnected = true;
    connectButton.textContent = 'Disconnect';
    connectButton.disabled = false;
    statusRow.className = 'status-connected';
    mqttClient.subscribe(`${mqttTopicInput.value}/2/e/#`);
}

function mqttOnDisconnect() {
    mqttConnected = false;
    mqttClient = null;
    connectButton.textContent = 'Connect';
    connectButton.disabled = false;
    mqttUrlInput.disabled = false;
    mqttTopicInput.disabled = false;
    statusRow.className = 'status-disconnected';
}

function onClickConnect() {
    connectButton.disabled = true;
    if (mqttConnected) {
        mqttClient.end(false, null, mqttOnDisconnect);
    } else {
        mqttUrlInput.disabled = true;
        mqttTopicInput.disabled = true;
        mqttClient = mqtt.connect(mqttUrlInput.value);
        mqttClient.on('connect', mqttOnConnect);
        mqttClient.on('message', mqttOnMessage);
        mqttClient.on('error', mqttOnDisconnect);
    }
}

const fields = [
    'rxTime', 'gatewayId', 'channelId', 'id', 'hopStart', 'hopLimit',
    'wantAck', 'viaMqtt', 'rxRssi', 'rxSnr', 'from', 'to', 'portnum',
];

function render(se) {
    var row = tbody.insertRow();
    fields.forEach((field) => {
        row.insertCell().innerHTML = se.header[field];
    });

    var decodedText = '';
    if (se.packet.encrypted) {
        decodedText += `x${arrayToString(se.packet.encrypted)} Encrypted\n`;
    }

    if (se.packet.decoded) {
        decodedText += `x${arrayToString(se.packet.decoded.payload)} Decrypted `

        const port = se.packet.decoded.portnum;
        var decode = null;
        if (port in meshtastic.protos) {
            decode = meshtastic.protos[port].decode;
        }

        if (decode) {
            try {
                decodedText += decode(se.packet.decoded.payload);
            } catch (error) {
                decodedText += `Error ${error}`;
            }
        } else {
            decodedText += `NYI ${port}`;
        }
    }

    var row = tbody.insertRow();
    row.className = 'decoded';
    var cell = row.insertCell();
    cell.colSpan = fields.length;
    var decoded = document.createElement('pre');
    cell.appendChild(decoded);
    decoded.textContent = decodedText;
}

var db = [];

function mqttOnMessage(topic, message) {
    var se = null;
    try {
        se = meshtastic.ServiceEnvelope.decode(message);
    } catch (error) {
        console.error(`Failed to decode ServiceEnvelope: ${error}`);
        console.error(`Topic: ${topic}`);
        console.error(`Message: x${arrayToString(message)}`);
        return;
    }

    if (se.packet.payloadVariant == 'encrypted' && se.channelId == 'LongFast') {
        decodeEncrypted(se.packet, defaultKey);
    }
    se.header = {};
    se.header.rxTime    = formatTime(se.packet.rxTime);
    se.header.gatewayId = se.gatewayId;
    se.header.channelId = se.channelId;
    se.header.id        = se.packet.id.toString(16).padStart(8, '0');
    se.header.hopStart  = se.packet.hopStart;
    se.header.hopLimit  = se.packet.hopLimit;
    se.header.wantAck   = se.packet.wantAck ? '1' : '0';
    se.header.viaMqtt   = se.packet.viaMqtt ? '1' : '0';
    se.header.rxRssi    = se.packet.rxRssi;
    se.header.rxSnr     = se.packet.rxSnr;
    se.header.from      = formatNodeId(se.packet.from);
    se.header.to        = formatNodeId(se.packet.to);
    if (se.packet.decoded) {
        se.header.portnum = se.packet.decoded.portnum;;
    } else {
        se.header.portnum = '?';
    }
    db.push(se);

    if (filterExpr(se.header)) {
        render(se);
    }

    window.scrollTo(0, document.body.scrollHeight);
}

function onFilterEnter() {
    filterInput.disabled = true;
    if (filterInput.value == '') {
        filterExpr = (_h) => { return true; };
    } else {
        filterExpr = eval?.(`(h) => { with (h) { return ${filterInput.value}; } }`);
    }

    tbody.innerHTML = '';
    db.forEach((se) => {
        if (filterExpr(se.header)) {
            render(se);
        }
    });

    filterInput.disabled = false;
    window.scrollTo(0, document.body.scrollHeight);
}

function onClickClear() {
    db = [];
    tbody.innerHTML = '';
}

window.onload = function() {
    var theadRow = document.getElementById('thead-row');
    fields.forEach((field) => {
        var th = theadRow.insertCell();
        th.innerHTML = field;
    });

    tbody = document.getElementById('tbody');

    statusRow = document.getElementById('status-row');
    document.getElementById('status-cell').colSpan = fields.length;
    document.getElementById('connect-cell').colSpan = fields.length;
    document.getElementById('filter-cell').colSpan = fields.length;

    mqttUrlInput = document.getElementById('mqtt-url');
    mqttUrlInput.placeholder = defaultMqttUrl;
    mqttUrlInput.defaultValue = defaultMqttUrl;

    mqttTopicInput = document.getElementById('mqtt-topic');
    mqttTopicInput.placeholder = defaultMqttTopic;
    mqttTopicInput.defaultValue = defaultMqttTopic;

    connectButton = document.getElementById('mqtt-connect');
    connectButton.addEventListener('click', onClickConnect);

    var clearButton = document.getElementById('clear');
    clearButton.addEventListener('click', onClickClear);

    filterInput = document.getElementById('filter-expr-input');
    filterInput.placeholder = 'Filter: a JavaScript expression over header fields, ' +
        'e.g. "channelId == \'LongFast\' && to != \'!ffffffff\'"';
    filterInput.addEventListener('keypress', function(e) {
        if (e.key == 'Enter') {
            onFilterEnter();
        }
    });

    connectButton.click();
};
