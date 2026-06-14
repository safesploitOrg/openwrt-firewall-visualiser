const assert = require("node:assert/strict");
const test = require("node:test");

const { createElement, loadApp } = require("./helpers/load-app");

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("parseOpenWrtFirewall parses zones, forwardings, rules, and unsupported fields", () => {
	const { app } = loadApp();
	const model = app.parseOpenWrtFirewall(`
config zone
	option name 'lan'
	option input 'ACCEPT'
	option output 'ACCEPT'
	option forward 'ACCEPT'
	list network 'lan'

config zone
	option name 'iot'
	option input 'REJECT'
	option output 'ACCEPT'
	option forward 'REJECT'
	list network 'iot'

config forwarding
	option src 'lan'
	option dest 'iot'

config rule
	option name 'Allow camera'
	option src 'lan'
	option dest 'iot'
	option dest_ip '172.16.20.50'
	option proto 'tcp'
	option dest_port '554'
	option target 'ACCEPT'
	option limit '10/sec'
`);

	assert.equal(model.zones.lan.forward, "ACCEPT");
	assert.deepEqual(plain(model.zones.iot.networks), ["iot"]);
	assert.deepEqual(plain(model.forwardings), [{ src: "lan", dest: "iot" }]);
	assert.equal(model.rules[0].name, "Allow camera");
	assert.equal(model.rules[0].index, 1);
	assert.deepEqual(plain(model.rules[0].unsupportedFields), ["limit"]);
});

test("evaluateDevicePath gives specific rules precedence over same-zone policy", () => {
	const { app } = loadApp();
	const firewallModel = app.parseOpenWrtFirewall(app.EXAMPLE_FIREWALL);
	app.__setState({ firewallModel });

	const alexaKitchen = { name: "Alexa Kitchen", ip: "172.16.20.10", zone: "iot" };
	const alexaBedroom = { name: "Alexa Bedroom", ip: "172.16.20.11", zone: "iot" };
	const camera = { name: "IoT Camera", ip: "172.16.20.50", zone: "iot" };

	const allowed = app.evaluateDevicePath(alexaKitchen, alexaBedroom);
	assert.equal(allowed.allowed, true);
	assert.match(allowed.reason, /Allow-Alexa-to-Alexa/);

	const blocked = app.evaluateDevicePath(camera, alexaBedroom);
	assert.equal(blocked.allowed, false);
	assert.match(blocked.reason, /Block-IoT-East-West/);
});

test("protocol and destination port criteria affect rule matching", () => {
	const { app } = loadApp();
	const firewallModel = app.parseOpenWrtFirewall(`
config zone
	option name 'lan'
	option forward 'ACCEPT'

config zone
	option name 'servers'
	option forward 'REJECT'

config rule
	option name 'Allow HTTPS'
	option src 'lan'
	option dest 'servers'
	option dest_ip '172.16.40.10'
	option proto 'tcp'
	option dest_port '443'
	option target 'ACCEPT'

config rule
	option name 'Block LAN to servers'
	option src 'lan'
	option dest 'servers'
	option target 'REJECT'
`);
	app.__setState({ firewallModel });

	const laptop = { name: "Laptop", ip: "172.16.10.20", zone: "lan" };
	const server = { name: "Server", ip: "172.16.40.10", zone: "servers" };

	assert.equal(app.evaluateDevicePath(laptop, server, { protocol: "tcp", destPort: "443" }).allowed, true);
	assert.equal(app.evaluateDevicePath(laptop, server, { protocol: "udp", destPort: "443" }).allowed, false);
	assert.equal(app.rulePortMatches("80,443,1000-1002", "1001"), true);
	assert.equal(app.ruleProtocolMatches("tcpudp", "udp"), true);
});

test("parseUciSubnetMappings converts router addresses to CIDR network mappings", () => {
	const { app } = loadApp();
	const result = app.parseUciSubnetMappings(`
firewall.@zone[0].name='iot'
firewall.@zone[0].network='iot'
network.iot.ipaddr='172.16.20.1'
network.iot.netmask='255.255.255.0'
not uci
`);

	assert.deepEqual(plain(result.mappings), ["172.16.20.0/24 iot"]);
	assert.deepEqual(plain(result.skipped), ["not uci"]);
	assert.equal(app.networkToCidr("172.16.30.1", "255.255.255.0"), "172.16.30.0/24");
});

test("parseBulkHosts supports host lists, DHCP leases, neighbour tables, and zone inference", () => {
	const { app } = loadApp();
	app.__setState({
		subnetMappingsText: "172.16.20.0/24 iot\n172.16.30.0/24 guest"
	});

	const result = app.parseBulkHosts(`
172.16.20.50 IoT-Camera
1710000000 aa:bb:cc:dd:ee:ff 172.16.30.25 Guest-Phone *
172.16.20.10 dev br-iot lladdr aa:bb:cc:dd:ee:00 REACHABLE
not a host
`);

	assert.equal(result.devices.length, 3);
	assert.deepEqual(plain(result.devices.map((device) => device.zone)), ["iot", "guest", "iot"]);
	assert.deepEqual(plain(result.devices.map((device) => device.source)), ["host-list", "dhcp", "neighbour"]);
	assert.equal(result.skipped.length, 1);
});

test("parseDeviceCsv supports headers and quoted values", () => {
	const { app } = loadApp();
	const devices = app.parseDeviceCsv(`ip,hostname,zone,mac
172.16.20.11,"Alexa, Bedroom",iot,aa:bb:cc:dd:ee:00`);

	assert.deepEqual(plain(devices), [{
		name: "Alexa, Bedroom",
		ip: "172.16.20.11",
		zone: "iot",
		mac: "aa:bb:cc:dd:ee:00",
		source: "import"
	}]);
});

test("mergeDevices preserves manual names and zones while adding missing metadata", () => {
	const { app } = loadApp();
	app.__setState({
		devices: [{ name: "Manual Camera", ip: "172.16.20.50", zone: "iot" }]
	});

	const result = app.mergeDevices([{
		name: "Imported Camera",
		ip: "172.16.20.50",
		zone: "guest",
		mac: "aa:bb:cc:dd:ee:ff",
		source: "dhcp"
	}]);

	assert.deepEqual(plain(result), { added: 0, updated: 1, skipped: 0, unresolved: 0 });
	assert.deepEqual(plain(app.__getState().devices), [{
		name: "Manual Camera",
		ip: "172.16.20.50",
		zone: "iot",
		mac: "aa:bb:cc:dd:ee:ff"
	}]);
});

test("clearExpiredState removes corrupted or expired localStorage payloads", () => {
	const { app, localStorage } = loadApp();
	localStorage.setItem(app.STORAGE_KEY, "{bad json");
	app.clearExpiredState();
	assert.equal(localStorage.getItem(app.STORAGE_KEY), null);

	localStorage.setItem(app.STORAGE_KEY, JSON.stringify({
		savedAt: Date.now() - app.STORAGE_TTL_MS - 1
	}));
	app.clearExpiredState();
	assert.equal(localStorage.getItem(app.STORAGE_KEY), null);
});

test("buildStatePayload includes import and UI state", () => {
	const firewallInput = createElement("firewallInput");
	firewallInput.value = "config zone";
	const graphFilter = createElement("graphFilter");
	graphFilter.value = "blocked";
	const { app } = loadApp({
		elements: {
			firewallInput,
			graphFilter
		}
	});
	app.__setState({
		devices: [{ name: "Laptop", ip: "172.16.10.20", zone: "lan" }],
		hostImportHasRun: true,
		importSectionCollapsed: true,
		subnetMappingsText: "172.16.10.0/24 lan"
	});

	const payload = app.buildStatePayload();

	assert.equal(payload.configText, "config zone");
	assert.equal(payload.graphFilter, "blocked");
	assert.equal(payload.importState.hostImportHasRun, true);
	assert.equal(payload.uiState.importSectionCollapsed, true);
	assert.deepEqual(payload.devices, [{ name: "Laptop", ip: "172.16.10.20", zone: "lan" }]);
});

test("renderImportSectionCollapsed updates class and button state", () => {
	const importSection = createElement("importSection");
	const importCollapseButton = createElement("importCollapseButton");
	const { app } = loadApp({
		elements: {
			importSection,
			importCollapseButton
		}
	});

	app.__setState({ importSectionCollapsed: true });
	app.renderImportSectionCollapsed();

	assert.equal(importSection.classList.contains("collapsed"), true);
	assert.equal(importCollapseButton.textContent, "Expand");
	assert.equal(importCollapseButton.attributes["aria-expanded"], "false");
});
