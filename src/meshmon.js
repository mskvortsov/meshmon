'use strict';

const defaultMqttUrl = 'wss://mqtt.eclipseprojects.io/mqtt';
const defaultMqttTopic = 'msh';
const defaultKey = CryptoJS.enc.Base64.parse('1PG7OiApB1nwvP+rz05pAQ==');
const defaultMaxPackets = 2048;

var packets = [];
var users = new Map();

var mqttUrlInput   = null;
var mqttTopicInput = null;
var mqttClient     = null;
var mqttStatusHint = null;

var tbody = null;
var statusRow = null;
var connectButton = null;
var filterInput = null;
var filterExpr = (_h) => { return true; };

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
    const words = CryptoJS.enc.Base64.parse(v);
    const bytes = wordsToByteArray(words);
    return Array.from(bytes).map((v) => formatHex(v, 2)).join(':');
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
    ['route',              formatRoute],
    ['macaddr',            formatMacaddr],
]);

function parseDefault(proto, name, payload) {
    const value = proto.decode(payload);
    const replacer = (k, v) => {
        const formatter = formatters.get(k);
        if (formatter) {
            return formatter(v);
        } else {
            return v;
        }
    };
    return {
        value: value,
        text: `${name} ${JSON.stringify(value, replacer, 2)}`,
    };
};

function parseText(_proto, name, payload) {
    const value = new TextDecoder().decode(payload);
    return {
        value: value,
        text: `${name}\n${text}`,
    };
}

const ParseResult = {
    Ok:  0,
    Err: 1,
    NYI: 2,
};

function parseDecoded(decoded) {
    const port = decoded.portnum;
    if (!(port in meshtastic.protos)) {
        return {
            status: ParseResult.NYI,
        };
    }
    const parse = meshtastic.protos[port].parse;
    try {
        const value = parse(decoded.payload);
        return {
            status: ParseResult.Ok,
            value: value,
        };
    } catch (error) {
        return {
            status: ParseResult.Err,
            error: error
        };
    }
}

function buildMeshtasticProtos() {
    var protobuf_root = new protobuf.Root();
    protobuf_root.resolvePath = function(_origin, target) {
        return `protobufs/${target}`;
    };

    const modules = ['meshtastic/mqtt.proto', 'meshtastic/storeforward.proto'];
    var meshtastic = {};

    protobuf_root.load(modules, function(err, root) {
        if (err)
            throw err;

        try {
            meshtastic.ServiceEnvelope = root.lookupType('meshtastic.ServiceEnvelope');
            meshtastic.Data            = root.lookupType('meshtastic.Data');
            meshtastic.PortNum         = root.lookupEnum('meshtastic.PortNum');
        } catch (error) {
            mqttStatusHint.innerHTML = error.toString();
            throw error;
        }

        const ports = meshtastic.PortNum.values;
        const protos = [
            { port: ports.TEXT_MESSAGE_APP,  name: 'Text',            parse: parseText },
            { port: ports.POSITION_APP,      name: 'Position',        parse: parseDefault },
            { port: ports.NODEINFO_APP,      name: 'User',            parse: parseDefault },
            { port: ports.ROUTING_APP,       name: 'Routing',         parse: parseDefault },
            { port: ports.STORE_FORWARD_APP, name: 'StoreAndForward', parse: parseDefault },
            { port: ports.TELEMETRY_APP,     name: 'Telemetry',       parse: parseDefault },
            { port: ports.TRACEROUTE_APP,    name: 'RouteDiscovery',  parse: parseDefault },
            { port: ports.NEIGHBORINFO_APP,  name: 'NeighborInfo',    parse: parseDefault },
        ];

        meshtastic.protos = {};
        protos.forEach((p) => {
            var proto = null;
            try {
                proto = root.lookupType('meshtastic.' + p.name);
            } catch (_error) {
            }
            meshtastic.protos[p.port] = {
                parse: (v) => { return p.parse(proto, p.name, v); },
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
    return Array.from(arr).map((v) => formatHex(v, 2)).join('');
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
        console.log(`failed to decode encrypted packet ${formatId(packet.id)}: ${error}`);
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

function mqttOnError(error) {
    mqttStatusHint.innerHTML = error.toString();
    resetToConnect();
}

function onClickConnect() {
    connectButton.disabled = true;
    if (mqttClient && mqttClient.connected) {
        mqttClient.on('close', mqttOnDisconnect);
        mqttClient.end();
    } else {
        mqttUrlInput.disabled = true;
        mqttTopicInput.disabled = true;
        try {
            mqttClient = mqtt.connect(mqttUrlInput.value, {
                reconnectPeriod: 0,
                connectTimeout: 5000,
                manualConnect: true,
            });
        } catch (error) {
            mqttStatusHint.innerHTML = error.toString();
            resetToConnect();
            return;
        }
        mqttClient.on('connect', mqttOnConnect);
        mqttClient.on('message', mqttOnMessage);
        mqttClient.on('error', mqttOnError);
        mqttClient.connect();
        mqttClient.stream.on('error', mqttOnError);
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

function render(se) {
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
        var value = se.header[field];
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
    if (se.packet.payloadVariant == 'encrypted') {
        text += `x${arrayToString(se.packet.encrypted)} Encrypted\n`;
    }

    if (se.parsed.status == ParseResult.Ok) {
        text += se.parsed.value.text;
    } else if (se.parsed.status == ParseResult.Err) {
        text += `Error ${se.parsed.error}`;
    } else if (se.parsed.status == ParseResult.NYI) {
        text += `NYI ${se.packet.decoded.portnum}`;
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

function mqttOnMessage(topic, message) {
    const topicLevels = topic.split('/');
    if (topicLevels.length == 0 || !topicLevels[topicLevels.length - 1].startsWith('!')) {
        console.log(`unexpected topic ${topic}`);
        return;
    }

    var se = null;
    try {
        se = meshtastic.ServiceEnvelope.decode(message);
    } catch (error) {
        console.error(`Failed to decode ServiceEnvelope: ${error}`);
        console.error(`Topic: ${topic}`);
        console.error(`Message: x${arrayToString(message)}`);
        return;
    }

    if (se.packet.payloadVariant == 'encrypted') {
        decodeEncrypted(se.packet, defaultKey);
    }
    se.header = {};
    se.header.rxTime    = formatTime(se.packet.rxTime);
    se.header.gatewayId = se.gatewayId;
    se.header.channelId = se.channelId;
    se.header.id        = formatId(se.packet.id);
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
    se.parsed = parseDecoded(se.packet.decoded);

    if (packets.length > defaultMaxPackets) {
        packets.shift();
    }
    packets.push(se);

    if (se.packet.decoded.portnum == meshtastic.PortNum.values.NODEINFO_APP &&
        se.parsed.status == ParseResult.Ok) {
        const user = se.parsed.value.value;
        users.set(user.id, user);
        document.getElementById('nodes-seen').innerHTML =
            users.size.toString().padStart(3, '0');;
    }

    const scrollDown = window.scrollY + window.innerHeight + 42 > document.body.scrollHeight;
    if (filterExpr(se.header)) {
        render(se);
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
    packets.forEach((se) => {
        if (filterExpr(se.header)) {
            render(se);
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
