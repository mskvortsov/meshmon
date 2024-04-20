'use strict';

import * as Protobufs from './protobufs.js';
import { stringify as yamlStringify } from 'yaml'

import CryptoJS from 'crypto-js/core';
import Base64 from 'crypto-js/enc-base64';
import AES from 'crypto-js/aes';
import 'crypto-js/mode-ctr';
import 'crypto-js/pad-nopadding';
import 'crypto-js/lib-typedarrays';

import Paho from 'paho-mqtt';

const defaultMqttUrl = 'mqtt.eclipseprojects.io';
const defaultMqttTopic = 'msh';
const defaultKey = Base64.parse('1PG7OiApB1nwvP+rz05pAQ==');
const defaultMaxPackets = 2048;

var packets        = [];
var users          = new Map();

var mqttUrlInput   = null;
var mqttTopicInput = null;
var mqttClient     = null;
var mqttStatusHint = null;
const mqttClientId = 'meshmon-' +
    formatHex(Math.floor(Math.random() * (2 ** 32 - 1)), 8);

var tbody          = null;
var statusRow      = null;
var connectButton  = null;
var filterInput    = null;
var filterExpr     = (_h) => { return true; };

function formatTime(v) {
    const t = new Date(v * 1000);
    return t.toISOString();
}

function formatHex(v, width) {
    return v.toString(16).padStart(width, '0');
}

function formatId(v) {
    return formatHex(v, 8);
}

function formatNodeId(v) {
    return '!' + formatHex(v, 8);
}

function formatFloat(v) {
    const n = new Number(v);
    return n.toFixed(2);
}

function formatCoord(v) {
    return v / 10000000;
}

function formatRoute(v) {
    const route = [];
    v.forEach((r) => {
        route.push(formatNodeId(r));
    });
    return route;
}

function formatMacaddr(v) {
    const words = Base64.parse(v);
    const bytes = wordsToByteArray(words);
    return Array.from(bytes).map((v) => formatHex(v, 2)).join(':');
}

function formatPayload(v) {
    const words = Base64.parse(v);
    const bytes = wordsToByteArray(words);
    return `x${arrayToString(bytes)}`;
}

const formatters = new Map([
    // Data
    ['payload',            formatPayload],
    ['dest',               formatNodeId],
    ['source',             formatNodeId],
    ['replyId',            formatId],
    ['requestId',          formatId],

    // Position
    ['latitudeI',          formatCoord],
    ['longitudeI',         formatCoord],

    // NeighborInfo
    ['nodeId',             formatNodeId],
    ['lastSentById',       formatNodeId],

    // RouteDiscovery
    ['route',              formatRoute],

    // Telemetry
    ['time',               formatTime],

    // DeviceMetrics
    ['voltage',            formatFloat],
    ['channelUtilization', formatFloat],
    ['airUtilTx',          formatFloat],

    // EnvironmentMetrics
    ['temperature',        formatFloat],
    ['relativeHumidity',   formatFloat],
    ['barometricPressure', formatFloat],
    ['gasResistance',      formatFloat],
    ['voltage',            formatFloat],
    ['current',            formatFloat],

    // User
    ['macaddr',            formatMacaddr],
]);

const ParseResult = {
    Ok:  0,
    Err: 1,
    NYI: 2,
};

function parseDecoded(data) {
    const typ = parsers.get(data.portnum);
    if (typ === undefined) {
        return {
            status: ParseResult.NYI,
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
            status: ParseResult.Ok,
            value: {
                message: message,
                text: `Data:\n${dataText}\n${typ.name}:\n${messageText}`,
            },
        };
    } catch (error) {
        return {
            status: ParseResult.Err,
            error: error
        };
    }
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
    return Array.from(arr).map((v) => formatHex(v, 2)).join('');
}

function decrypt(packet, key) {
    const iv = CryptoJS.lib.WordArray.create([
        swap32(packet.id), 0,
        swap32(packet.from), 0,
    ]);

    const encrypted = CryptoJS.lib.WordArray.create(packet.payloadVariant.value);
    const decrypted = AES.decrypt(
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
        return Protobufs.Mesh.Data.fromBinary(wordsToByteArray(decrypted));
    } catch (error) {
        return undefined;
    }
}

function mqttOnConnect() {
    connectButton.textContent = 'Disconnect';
    connectButton.disabled = false;
    statusRow.className = 'status-connected';
    mqttStatusHint.innerHTML = '';
    mqttClient.subscribe(`${mqttTopicInput.value}/2/c/+/+`);
    mqttClient.subscribe(`${mqttTopicInput.value}/2/e/+/+`);
    localStorage.setItem('url', mqttUrlInput.value);
    localStorage.setItem('topic', mqttTopicInput.value);
}

function resetToConnect() {
    mqttClient = null;
    connectButton.textContent = 'Connect';
    connectButton.disabled = false;
    mqttUrlInput.disabled = false;
    mqttTopicInput.disabled = false;
    statusRow.className = 'status-disconnected';
}

function mqttOnDisconnect() {
    resetToConnect();
}

function mqttOnFailure(error) {
    mqttStatusHint.innerHTML = error.errorMessage;
    resetToConnect();
}

function onClickConnect() {
    connectButton.disabled = true;
    if (mqttClient && mqttClient.isConnected()) {
        mqttClient.disconnect();
    } else {
        mqttUrlInput.disabled = true;
        mqttTopicInput.disabled = true;
        try {
            mqttClient = new Paho.Client(mqttUrlInput.value, 443, '/mqtt', mqttClientId);
            mqttClient.onMessageArrived = mqttOnMessage;
            mqttClient.onConnectionLost = mqttOnDisconnect;
            mqttClient.connect({
                useSSL: true,
                onSuccess: mqttOnConnect,
                onFailure: mqttOnFailure,
                timeout: 5,
            });
        } catch (error) {
            mqttStatusHint.innerHTML = error.errorMessage;
            resetToConnect();
            return;
        }
    }
}

const fields = [
    'rxTime', 'gatewayId', 'channelId', 'id', 'hopStart', 'hopLimit',
    'wantAck', 'viaMqtt', 'rxRssi', 'rxSnr', 'from', 'to', 'portnum',
];
const dummyHeader = {
    rxTime: new Date(0).toISOString(),
    gatewayId: '!00000000',
    channelId: 'LongChannelName',
    id: '00000000',
    hopStart: 0,
    hopLimit: 0,
    wantAck: '0',
    viaMqtt: '0',
    rxRssi: -120,
    rxSnr: -20.25,
    from: '!00000000',
    to: '!00000000',
    portnum: '75',
};

function tooltipOnMouseOver(e) {
    const spanIdText = e.target;
    const spanTooltipText = spanIdText.nextElementSibling;
    const id = spanIdText.innerHTML;

    const user = users.get(id);
    if (user !== undefined) {
        spanTooltipText.innerHTML = `${user.shortName} ${user.longName}`;
    }
}

function render(se, header, data, parsed) {
    if (tbody.rows.length > defaultMaxPackets * 2) {
        tbody.deleteRow(0);
        tbody.deleteRow(0);
    }

    var headerRow = tbody.insertRow();
    if (se.packet.rxRssi == 0) {
        headerRow.className = 'packet-header-row-outbound verbatim';
    } else {
        headerRow.className = 'packet-header-row verbatim';
    }

    fields.forEach((field) => {
        const cell = headerRow.insertCell();
        var value = header[field];
        if (value == '!ffffffff') {
            cell.innerHTML = value;
        } else if (field == 'gatewayId' || field == 'from' || field == 'to') {
            const spanIdText = document.createElement('span');
            spanIdText.innerHTML = value;
            spanIdText.onmouseover = tooltipOnMouseOver;

            const spanTooltipText = document.createElement('span');
            spanTooltipText.className = 'node-tooltip-text';
            spanTooltipText.innerHTML = '<i>Unknown</i>';

            const spanTooltip = document.createElement('span');
            spanTooltip.className = 'node-tooltip';

            spanTooltip.appendChild(spanIdText);
            spanTooltip.appendChild(spanTooltipText);
            cell.appendChild(spanTooltip);
        } else {
            cell.innerHTML = value;
        }
    });

    var text = '';
    if (se.packet.payloadVariant.case == 'encrypted') {
        text += `Encrypted x${arrayToString(se.packet.payloadVariant.value)}\n`;
    }

    if (parsed.status == ParseResult.Ok) {
        text += parsed.value.text;
    } else if (parsed.status == ParseResult.Err) {
        text += `Error ${parsed.error.message}`;
    } else if (parsed.status == ParseResult.NYI) {
        text += `NYI ${data.portnum}`;
    } else {
        console.error('parsing error');
    }

    var decodedRow = tbody.insertRow();
    decodedRow.className = 'packet-decoded verbatim';
    var cell = decodedRow.insertCell();
    cell.colSpan = fields.length;
    var decoded = document.createElement('pre');
    decoded.textContent = text;
    cell.appendChild(decoded);

    headerRow.onclick = () => {
        if (document.getSelection() != "") {
            return;
        }
        headerRow.classList.toggle('selected');
        headerRow.nextElementSibling.classList.toggle('selected');
    };
    decodedRow.onclick = () => {
        if (document.getSelection() != "") {
            return;
        }
        decodedRow.previousElementSibling.classList.toggle('selected');
        decodedRow.classList.toggle('selected');
    };
}

function mqttOnMessage(message) {
    const topicLevels = message.topic.split('/');
    if (topicLevels.length == 0 || !topicLevels[topicLevels.length - 1].startsWith('!')) {
        console.log(`unexpected topic ${topic}`);
        return;
    }

    var se = null;
    try {
        se = Protobufs.Mqtt.ServiceEnvelope.fromBinary(message.payloadBytes);
    } catch (error) {
        console.error(`Failed to decode ServiceEnvelope: ${error}`);
        console.error(`Topic: ${message.topic}`);
        console.error(`Message: x${arrayToString(message.payloadBytes)}`);
        return;
    }

    const data = se.packet.payloadVariant.case == 'encrypted' ?
        decrypt(se.packet, defaultKey) :
        se.packet.payloadVariant.value;

    const header = {
        rxTime:    formatTime(se.packet.rxTime),
        gatewayId: se.gatewayId,
        channelId: se.channelId,
        id:        formatId(se.packet.id),
        hopStart:  se.packet.hopStart,
        hopLimit:  se.packet.hopLimit,
        wantAck:   se.packet.wantAck ? '1' : '0',
        viaMqtt:   se.packet.viaMqtt ? '1' : '0',
        rxRssi:    se.packet.rxRssi,
        rxSnr:     se.packet.rxSnr,
        from:      formatNodeId(se.packet.from),
        to:        formatNodeId(se.packet.to),
    };

    var parsed = null;
    if (data !== undefined) {
        header.portnum = data.portnum;
        parsed = parseDecoded(data);
    } else {
        header.portnum = '?';
        parsed = {
            status: ParseResult.Err,
            error: new Error('Decoding failure')
        };
    }

    if (packets.length > defaultMaxPackets) {
        packets.shift();
    }
    packets.push({ se, header, data, parsed });

    if (data && data.portnum == Protobufs.Portnums.PortNum.NODEINFO_APP &&
        parsed.status == ParseResult.Ok) {
        const user = parsed.value.message;
        users.set(user.id, user);
        document.getElementById('nodes-seen').innerHTML =
            users.size.toString().padStart(3, '0');;
    }

    const scrollDown = window.scrollY + window.innerHeight + 42 > document.body.scrollHeight;
    if (filterExpr(header)) {
        render(se, header, data, parsed);
    }

    if (scrollDown) {
        window.scrollTo(0, document.body.scrollHeight);
    }
}

function onFilterEnter() {
    filterInput.disabled = true;
    if (filterInput.value == '') {
        filterExpr = (_h) => { return true; };
        filterInput.classList.remove('filter-ok');
        filterInput.classList.remove('filter-error');
    } else {
        const newFilterExpr = new Function('h', `{
            const { ${fields.join(', ')} } = h;
            return ${filterInput.value};
        }`);
        try {
            newFilterExpr(dummyHeader);
            filterExpr = newFilterExpr;
            filterInput.classList.remove('filter-error');
            filterInput.classList.add('filter-ok');
        } catch {
            filterInput.classList.remove('filter-ok');
            filterInput.classList.add('filter-error');
            filterInput.disabled = false;
            return;
        }
    }

    tbody.innerHTML = '';
    packets.forEach(({ se, header, data, parsed }) => {
        if (filterExpr(header)) {
            render(se, header, data, parsed);
        }
    });

    filterInput.disabled = false;
    window.scrollTo(0, document.body.scrollHeight);
}

function onClickClear() {
    packets = [];
    tbody.innerHTML = '';
}

function switchTheme(e) {
    if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }
}

window.onload = function() {
    var theadRow = document.getElementById('thead-row');
    var fitRow = document.getElementById('fit-row');
    fields.forEach((field) => {
        var th = theadRow.insertCell();
        th.innerHTML = field;
        var tf = fitRow.insertCell();
        tf.innerHTML = dummyHeader[field];
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

    mqttStatusHint = document.getElementById('mqtt-status');

    connectButton = document.getElementById('mqtt-connect');
    connectButton.addEventListener('click', onClickConnect);

    document.getElementById('clear').addEventListener('click', onClickClear);
    document.getElementById('unselect').addEventListener('click', function() {
        Array.from(tbody.rows).forEach((row) => {
            row.classList.remove('selected');
        });
    });

    filterInput = document.getElementById('filter-expr-input');
    filterInput.placeholder = 'Filter: a JavaScript expression over header fields, ' +
        'e.g. "channelId == \'LongFast\' && to != \'!ffffffff\'"';
    filterInput.addEventListener('keypress', function(e) {
        if (e.key == 'Enter') {
            onFilterEnter();
        }
    });

    mqttUrlInput.value = localStorage.getItem('url') ?? defaultMqttUrl;
    mqttTopicInput.value = localStorage.getItem('topic') ?? defaultMqttTopic;

    const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
    const currentTheme = localStorage.getItem('theme');

    if (currentTheme) {
        document.documentElement.setAttribute('data-theme', currentTheme);
        if (currentTheme === 'dark') {
            toggleSwitch.checked = true;
        }
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
        toggleSwitch.checked = true;
    }

    toggleSwitch.addEventListener('change', switchTheme, false);
    connectButton.click();
};
