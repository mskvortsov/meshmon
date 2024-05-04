import * as Parser from './parser.js';
import Paho from 'paho-mqtt';

const defaultMqttUrl = 'mqtt.eclipseprojects.io';
const defaultMqttTopic = 'msh';
const defaultMaxPackets = 2048;

const fields = [
  ['rxTime',    'time', 'The time the message was received by the node'],
  ['gatewayId', 'gw',   'The sending MQTT-gateway node ID'],
  ['channelId', 'ch',   'The global channel ID the message was sent on'],
  ['id',        'id',   'The unique ID for the packet'],
  ['from',      'from', 'The sending node ID'],
  ['to',        'to',   'The (immediate) destination node ID for the packet'],
  ['hopStart',  'hs',   'The hop limit with which the original packet started'],
  ['hopLimit',  'hl',   'The maximum number of hops allowed'],
  ['wantAck',   'wa',   'Whether it is expected to receive an ack packet in response'],
  ['viaMqtt',   'vm',   'Whether the packet passed via MQTT somewhere along the path it currently took'],
  ['priority',  'pri',  'The priority of the packet for sending'],
  ['rxRssi',    'rssi', 'Received Signal Strength Indicator for the received packet'],
  ['rxSnr',     'snr',  'Signal-to-Noise Ratio for the recived packet'],
  ['portnum',   'port', 'The tag of the Data payload type'],
];

const dummyHeader = {
  time: new Date(0).toISOString(),
  gw:   '!00000000',
  ch:   'ElevenChars',
  id:   '00000000',
  hs:   0,
  hl:   0,
  wa:   '0',
  vm:   '0',
  pri:  127,
  rssi: -120,
  snr:  -20.25,
  from: '!00000000',
  to:   '!00000000',
  port: '511',
};

var packets = [];
var users = new Map();

var mqttUrlInput = null;
var mqttTopicInput = null;
var mqttClient = null;
var mqttStatusHint = null;
const mqttClientId = 'meshmon-' +
  Parser.hex(Math.floor(Math.random() * (2 ** 32 - 1)), 8);

var tbody = null;
var statusRow = null;
var connectButton = null;
var filterInput = null;
var filterExpr = (_h) => { return true; };

class SeenMessages {
  constructor(timeout = 60000) {
    this.timeout = timeout;
    this.table = new Map();
  }
  addAndCheck(id) {
    const now = Date.now();
    this.table.forEach((time, id, table) => {
      if (time < now - this.timeout) {
        table.delete(id);
      }
    });
    const ret = this.table.has(id);
    this.table.set(id, now);
    return ret;
  }
};

const seenMessages = new SeenMessages();

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

function tooltipOnMouseOver(e) {
  const spanIdText = e.target;
  const spanTooltipText = spanIdText.nextElementSibling;
  const id = spanIdText.innerHTML;

  const user = users.get(id);
  if (user !== undefined) {
    spanTooltipText.innerHTML = `${user.shortName} ${user.longName}`;
  }
}

function updateCollapser(cell, collapsed) {
  if (collapsed) {
    cell.innerHTML = '+';
    cell.title = 'Expand';
  } else {
    cell.innerHTML = '-';
    cell.title = 'Collapse';
  }
}

function renderCollapser(cell, collapsed) {
  cell.classList.add('collapser');
  updateCollapser(cell, collapsed);

  cell.onclick = (e) => {
    e.stopPropagation();
    const td = e.target;
    const decodedRow = td.parentNode.nextElementSibling;
    const collapsed = decodedRow.classList.toggle('collapsed');
    updateCollapser(cell, collapsed);
  };
}

function renderHexPayload(cell, payload) {
  const spanContent = document.createElement('span');
  spanContent.innerHTML = Parser.bytesToString(payload);
  spanContent.hidden = true;
  cell.appendChild(spanContent);

  const spanMark = document.createElement('span');
  spanMark.innerHTML = 'B';
  cell.appendChild(spanMark);

  cell.classList.add('payload');
  cell.title = 'Copy ServiceEnvelope bytes to clipboard';
  cell.onclick = (e) => {
    e.stopPropagation();
    const content = e.currentTarget.firstChild.innerHTML;
    navigator.clipboard.writeText(content);
    e.currentTarget.animate([
      { opacity: 0.5 },
      { opacity: 1.0 },
    ], 300);
  }
}

function renderHeaderRow(payload, se, header, collapsed) {
  const row = tbody.insertRow();
  if (se.packet.rxRssi == 0) {
    row.className = 'packet-header-row-outbound verbatim';
  } else {
    row.className = 'packet-header-row verbatim';
  }

  renderCollapser(row.insertCell(), collapsed);
  renderHexPayload(row.insertCell(), payload);

  fields.forEach(([_fieldId, fieldName, _fieldDesc]) => {
    const cell = row.insertCell();
    var value = header[fieldName];
    if (value == '!ffffffff') {
      cell.innerHTML = value;
    } else if (fieldName == 'gw' || fieldName == 'from' || fieldName == 'to') {
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

  row.onclick = () => {
    if (document.getSelection() != "") {
      return;
    }
    row.classList.toggle('selected');
    row.nextElementSibling.classList.toggle('selected');
  };
}

function renderDecodedRow(text, collapsed) {
  const row = tbody.insertRow();
  row.className = 'packet-decoded verbatim';
  if (collapsed) {
    row.classList.add('collapsed');
  }

  const cell = row.insertCell();
  cell.colSpan = fields.length + 2;
  const pre = document.createElement('pre');
  pre.textContent = text;
  cell.appendChild(pre);

  row.onclick = () => {
    if (document.getSelection() != "") {
      return;
    }
    row.previousElementSibling.classList.toggle('selected');
    row.classList.toggle('selected');
  };
}

function render(payload, se, header, parsed, forceExpanded) {
  if (tbody.rows.length > defaultMaxPackets * 2) {
    tbody.deleteRow(0);
    tbody.deleteRow(0);
  }

  const collapsed = !forceExpanded && seenMessages.addAndCheck(header.id);
  renderHeaderRow(payload, se, header, collapsed);

  var text;
  if (parsed.status == Parser.Result.Ok) {
    text = parsed.value.text;
  } else if (parsed.status == Parser.Result.Err) {
    text = `Error ${parsed.error.message}`;
  } else if (parsed.status == Parser.Result.Nyi) {
    text = `NYI ${header.port}`;
  } else {
    console.assert(false);
  }

  renderDecodedRow(text, collapsed);
}

function mqttOnMessage(message) {
  const topicLevels = message.topic.split('/');
  if (topicLevels.length == 0 || !topicLevels[topicLevels.length - 1].startsWith('!')) {
    console.log(`Unexpected topic ${topic}`);
    return;
  }

  const { se, header, parsed, isUser } = Parser.parse(message);
  if (se.status != Parser.Result.Ok) {
    console.assert(se.status == Parser.Result.Err);
    console.log(se.error);
    return;
  }
  if (header.status != Parser.Result.Ok) {
    console.assert(header.status == Parser.Result.Err);
    console.log(header.error);
    return;
  }

  while (packets.length > defaultMaxPackets) {
    packets.shift();
  }
  packets.push({
    payload: message.payloadBytes,
    se: se.value,
    header: header.value,
    parsed
  });

  if (isUser) {
    console.assert(parsed.status == Parser.Result.Ok);
    const user = parsed.value.message;
    users.set(user.id, user);
    document.getElementById('nodes-seen').innerHTML =
      users.size.toString().padStart(3, '0');;
  }

  const scrollDown = window.scrollY + window.innerHeight + 42 > document.body.scrollHeight;
  if (filterExpr(header.value)) {
    render(message.payloadBytes, se.value, header.value, parsed, false);
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
      const { ${fields.map((field) => field[1]).join(', ')} } = h;
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
  packets.forEach(({ payload, se, header, parsed }) => {
    if (filterExpr(header)) {
      render(payload, se, header, parsed, true);
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

function renderFitRow() {
  const theadRow = document.getElementById('thead-row');
  const fitRow = document.getElementById('fit-row');
  // header field for hidning the decoded row
  theadRow.insertCell();
  fitRow.insertCell().innerHTML = ' ';
  // header field for copying payload
  theadRow.insertCell();
  fitRow.insertCell().innerHTML = ' ';
  // ordinary header field columns
  fields.forEach(([fieldId, fieldName, fieldDesc]) => {
    const th = theadRow.insertCell();
    const div = document.createElement('div');
    div.innerHTML = fieldName;
    div.title = `(${fieldId}) ${fieldDesc}`;
    th.appendChild(div);
    const tf = fitRow.insertCell();
    tf.innerHTML = dummyHeader[fieldName];
  });
}

function setupThemeSwitcher() {
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
}

function setup() {
  renderFitRow();

  tbody = document.getElementById('tbody');

  statusRow = document.getElementById('status-row');
  document.getElementById('status-cell').colSpan  = fields.length + 2;
  document.getElementById('connect-cell').colSpan = fields.length + 2;
  document.getElementById('filter-cell').colSpan  = fields.length + 2;

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
  document.getElementById('unselect').addEventListener('click', function () {
    Array.from(tbody.rows).forEach((row) => {
      row.classList.remove('selected');
    });
  });

  filterInput = document.getElementById('filter-expr-input');
  filterInput.placeholder =
    'Filter: a JavaScript expression over header fields, ' +
    'e.g. "ch == \'LongFast\' && to != \'!ffffffff\'"';
  filterInput.addEventListener('keypress', function (e) {
    if (e.key == 'Enter') {
      onFilterEnter();
    }
  });

  mqttUrlInput.value = localStorage.getItem('url') ?? defaultMqttUrl;
  mqttTopicInput.value = localStorage.getItem('topic') ?? defaultMqttTopic;

  setupThemeSwitcher();
}

setup();
connectButton.click();
