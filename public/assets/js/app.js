const EXAMPLE_FIREWALL = `config zone
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

config zone
	option name 'guest'
	option input 'REJECT'
	option output 'ACCEPT'
	option forward 'REJECT'
	list network 'guest'

config zone
	option name 'wan'
	option input 'REJECT'
	option output 'ACCEPT'
	option forward 'REJECT'
	option masq '1'
	list network 'wan'

config forwarding
	option src 'lan'
	option dest 'wan'

config forwarding
	option src 'iot'
	option dest 'wan'

config forwarding
	option src 'guest'
	option dest 'wan'

config rule
	option name 'Allow-Alexa-to-Alexa'
	option src 'iot'
	option dest 'iot'
	option src_ip '172.16.20.10'
	option dest_ip '172.16.20.11'
	option target 'ACCEPT'

config rule
	option name 'Block-IoT-East-West'
	option src 'iot'
	option dest 'iot'
	option target 'REJECT'`;

const DEFAULT_DEVICES = [
	{ name: "Admin Laptop", ip: "172.16.10.20", zone: "lan" },
	{ name: "Alexa Kitchen", ip: "172.16.20.10", zone: "iot" },
	{ name: "Alexa Bedroom", ip: "172.16.20.11", zone: "iot" },
	{ name: "IoT Camera", ip: "172.16.20.50", zone: "iot" },
	{ name: "Guest Phone", ip: "172.16.30.25", zone: "guest" }
];

const DEFAULT_SUBNET_MAPPINGS = `172.16.10.0/24 lan
172.16.20.0/24 iot
172.16.30.0/24 guest`;

const STORAGE_KEY = "openwrt-firewall-visualiser-state";
const STORAGE_TTL_DAYS = 45;
const STORAGE_TTL_MS = STORAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
const CURRENT_YEAR_ID = "currentYear";
const DEFAULT_TEST_PATH = {
	srcIndex: "0",
	dstIndex: "1"
};
const DEFAULT_PATH_CRITERIA = {
	protocol: "",
	destPort: ""
};
const RELATIONSHIP_PREVIEW_LIMIT = 15;
const VALID_GRAPH_LAYOUTS = ["cose", "circle", "breadthfirst"];
const VALID_GRAPH_FILTERS = ["all", "allowed", "blocked", "zones", "devices"];
const SUPPORTED_RULE_FIELDS = ["name", "src", "dest", "src_ip", "dest_ip", "proto", "dest_port", "target", "family", "enabled"];

let devices = structuredClone(DEFAULT_DEVICES);
let subnetMappingsText = DEFAULT_SUBNET_MAPPINGS;

let firewallModel = {
	zones: {},
	forwardings: [],
	rules: []
};

let cy = null;
let currentLayout = "cose";
let selectedTestPath = structuredClone(DEFAULT_TEST_PATH);
let selectedPathCriteria = structuredClone(DEFAULT_PATH_CRITERIA);
let graphPathHighlightRequested = false;
let relationshipMapExpanded = false;
let hostImportHasRun = false;
let subnetImportHasRun = false;
let sessionImportHasRun = false;
let importSectionCollapsed = false;
let storageAvailable = true;

const autoParse = debounce(() => {
	parseAndRender();
}, 500);

function main() {
	setCurrentYear();
	loadState();
	bindReactiveControls();
	renderImportSectionCollapsed();
	renderDeviceInputs();
	renderSubnetMappings();
	renderPathCriteria();
	parseAndRender({ persist: false });
}

function toggleHelp() {
	document.getElementById("helpBox").classList.toggle("hidden");
}

function toggleSubnetHelp() {
	document.getElementById("subnetHelpBox").classList.toggle("hidden");
}

function toggleImportHelp() {
	document.getElementById("importHelpBox").classList.toggle("hidden");
}

function toggleImportSectionCollapsed() {
	importSectionCollapsed = !importSectionCollapsed;
	renderImportSectionCollapsed();
	saveState();
}

function renderImportSectionCollapsed() {
	const section = document.getElementById("importSection");
	const button = document.getElementById("importCollapseButton");

	if (section) {
		section.classList.toggle("collapsed", importSectionCollapsed);
	}

	if (button) {
		button.textContent = importSectionCollapsed ? "Expand" : "Collapse";
		button.setAttribute("aria-expanded", String(!importSectionCollapsed));
	}
}

function loadExample() {
	if (!confirm("Load the example config and reset devices? Current unsaved page state will be replaced.")) {
		return;
	}

	document.getElementById("firewallInput").value = EXAMPLE_FIREWALL;
	devices = structuredClone(DEFAULT_DEVICES);
	subnetMappingsText = DEFAULT_SUBNET_MAPPINGS;
	selectedTestPath = structuredClone(DEFAULT_TEST_PATH);
	selectedPathCriteria = structuredClone(DEFAULT_PATH_CRITERIA);
	graphPathHighlightRequested = false;
	hostImportHasRun = false;
	subnetImportHasRun = false;
	sessionImportHasRun = false;
	importSectionCollapsed = false;
	renderImportSectionCollapsed();
	renderDeviceInputs();
	renderSubnetMappings();
	renderPathCriteria();
	parseAndRender();
}

function toggleGraphExpanded() {
	const panel = document.getElementById("graphPanel");
	const button = document.getElementById("graphExpandButton");

	if (!panel) {
		return;
	}

	panel.classList.toggle("expanded");

	if (button) {
		button.textContent = panel.classList.contains("expanded") ? "Collapse Graph" : "Expand Graph";
	}

	window.setTimeout(fitGraph, 50);
}

function loadConfigFile(event) {
	const file = event.target.files[0];

	if (!file) {
		return;
	}

	const reader = new FileReader();

	reader.onload = function(e) {
		document.getElementById("firewallInput").value = e.target.result;
		parseAndRender();
	};

	reader.readAsText(file);
}

function addDevice() {
	devices.push({
		name: "New Device",
		ip: "172.16.x.x",
		zone: "iot"
	});

	renderDeviceInputs();
	parseAndRender();
}

function resetDevices() {
	devices = structuredClone(DEFAULT_DEVICES);
	selectedTestPath = structuredClone(DEFAULT_TEST_PATH);
	graphPathHighlightRequested = false;
	hostImportHasRun = false;
	sessionImportHasRun = false;
	renderDeviceInputs();
	parseAndRender();
}

function renderDeviceInputs() {
	const container = document.getElementById("deviceInputs");
	container.innerHTML = "";

	devices.forEach((device, index) => {
		const row = document.createElement("div");
		row.className = "device-row";

		row.innerHTML = `
			<input value="${escapeHtml(device.name)}" onchange="updateDevice(${index}, 'name', this.value)" placeholder="Device name">
			<input value="${escapeHtml(device.ip)}" onchange="updateDevice(${index}, 'ip', this.value)" placeholder="IP address">
			<input value="${escapeHtml(device.zone)}" onchange="updateDevice(${index}, 'zone', this.value)" placeholder="Zone">
			<button onclick="removeDevice(${index})">Remove</button>
		`;

		container.appendChild(row);
	});

	renderDeviceSelectors();
}

function renderSubnetMappings() {
	const textarea = document.getElementById("subnetMappings");

	if (!textarea) {
		return;
	}

	textarea.value = subnetMappingsText;
}

function renderPathCriteria() {
	const protocolSelect = document.getElementById("pathProtocol");
	const portInput = document.getElementById("pathDestPort");

	if (protocolSelect) {
		protocolSelect.value = selectedPathCriteria.protocol;
	}

	if (portInput) {
		portInput.value = selectedPathCriteria.destPort;
	}
}

function renderImportChecklist() {
	const container = document.getElementById("importChecklist");

	if (!container) {
		return;
	}

	const zoneCount = Object.keys(firewallModel.zones).length;
	const subnetCount = parseSubnetMappings(subnetMappingsText).length;
	const importedDeviceCount = devices.filter((device) => device.source || device.mac).length;
	const deviceCount = devices.length;

	const items = [
		{
			done: zoneCount > 0,
			title: "Firewall config parsed",
			detail: zoneCount > 0 ? `${zoneCount} firewall zones detected.` : "Paste /etc/config/firewall, then parse."
		},
		{
			done: subnetCount > 0,
			title: "Subnet mappings ready",
			detail: subnetCount > 0 ? `${subnetCount} CIDR mappings available for zone inference.` : "Add manual mappings or import OpenWrt UCI subnet data."
		},
		{
			done: deviceCount > 0,
			title: "Devices available",
			detail: deviceCount > 0 ? `${deviceCount} devices are mapped.` : "Add devices manually or import hosts."
		},
		{
			done: hostImportHasRun || importedDeviceCount > 0,
			title: "Host inventory imported",
			detail: hostImportHasRun || importedDeviceCount > 0 ? `${importedDeviceCount} devices include import metadata.` : "Optional: import DHCP, ARP, neighbour, host-list, or OpenWrt export data."
		},
		{
			done: sessionImportHasRun,
			title: "Session/device file imported",
			detail: sessionImportHasRun ? "A JSON/CSV file has been imported this session." : "Optional: import a previous session or device CSV/JSON."
		}
	];

	container.innerHTML = items.map((item) => {
		return `
			<div class="check-item ${item.done ? "done" : "todo"}">
				<span class="check-mark">${item.done ? "✓" : "!"}</span>
				<span><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.detail)}</span>
			</div>
		`;
	}).join("");
}

function handleSubnetMappingsChange() {
	const textarea = document.getElementById("subnetMappings");
	subnetMappingsText = textarea ? textarea.value : DEFAULT_SUBNET_MAPPINGS;
	parseAndRender();
}

function updateDevice(index, key, value) {
	if (!devices[index]) {
		return;
	}

	devices[index][key] = value.trim();
	parseAndRender();
}

function removeDevice(index) {
	devices.splice(index, 1);
	renderDeviceInputs();
	parseAndRender();
}

function parseAndRender(options = {}) {
	const shouldPersist = options.persist !== false;
	const configText = document.getElementById("firewallInput").value;
	firewallModel = parseOpenWrtFirewall(configText);

	renderSummary();
	renderGraph();
	renderZoneView();
	renderMatrix();
	renderDeviceSelectors();
	renderImportChecklist();
	renderRelationshipMap();
	renderAnalysisFindings();
	renderCurrentTestResult(false, { highlight: false });

	if (shouldPersist) {
		saveState();
	}
}

function bindReactiveControls() {
	const firewallInput = document.getElementById("firewallInput");
	const srcSelect = document.getElementById("srcDevice");
	const dstSelect = document.getElementById("dstDevice");
	const pathProtocol = document.getElementById("pathProtocol");
	const pathDestPort = document.getElementById("pathDestPort");

	if (firewallInput) {
		firewallInput.addEventListener("input", autoParse);
		firewallInput.addEventListener("change", () => parseAndRender());
	}

	if (srcSelect) {
		srcSelect.addEventListener("change", handleTestSelectorChange);
	}

	if (dstSelect) {
		dstSelect.addEventListener("change", handleTestSelectorChange);
	}

	if (pathProtocol) {
		pathProtocol.addEventListener("change", handlePathCriteriaChange);
	}

	if (pathDestPort) {
		pathDestPort.addEventListener("input", handlePathCriteriaChange);
	}

	window.addEventListener("beforeunload", saveState);
}

function handleTestSelectorChange() {
	updateSelectedTestPathFromSelectors();
	graphPathHighlightRequested = false;
	renderCurrentTestResult(true, { highlight: false });
}

function handlePathCriteriaChange() {
	updatePathCriteriaFromInputs();
	graphPathHighlightRequested = false;
	parseAndRender();
}

function loadState() {
	clearExpiredState();
	const savedState = readStoredState();
	const firewallInput = document.getElementById("firewallInput");
	const graphFilter = document.getElementById("graphFilter");

	firewallInput.value = typeof savedState.configText === "string"
		? savedState.configText
		: EXAMPLE_FIREWALL;
	devices = normaliseSavedDevices(savedState.devices);
	subnetMappingsText = typeof savedState.subnetMappingsText === "string"
		? savedState.subnetMappingsText
		: DEFAULT_SUBNET_MAPPINGS;
	currentLayout = normaliseGraphLayout(savedState.graphLayout);
	selectedTestPath = normaliseSavedTestPath(savedState.testPath);
	selectedPathCriteria = normalisePathCriteria(savedState.pathCriteria);
	hostImportHasRun = Boolean(savedState.importState?.hostImportHasRun);
	subnetImportHasRun = Boolean(savedState.importState?.subnetImportHasRun);
	sessionImportHasRun = Boolean(savedState.importState?.sessionImportHasRun);
	importSectionCollapsed = Boolean(savedState.uiState?.importSectionCollapsed);
	graphPathHighlightRequested = false;

	if (graphFilter) {
		graphFilter.value = normaliseGraphFilter(savedState.graphFilter);
	}
}

function saveState() {
	if (!storageAvailable) {
		return;
	}

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStatePayload()));
	} catch (error) {
		storageAvailable = false;
		console.warn("Local storage is unavailable. Session state will not persist.", error);
	}
}

function clearExpiredState() {
	if (!storageAvailable) {
		return;
	}

	let rawState = null;

	try {
		rawState = window.localStorage.getItem(STORAGE_KEY);
	} catch (error) {
		storageAvailable = false;
		console.warn("Local storage is unavailable. Starting with defaults.", error);
		return;
	}

	if (!rawState) {
		return;
	}

	try {
		const parsedState = JSON.parse(rawState);

		if (!parsedState || typeof parsedState !== "object" || !parsedState.savedAt) {
			return;
		}

		const savedAt = Number(parsedState.savedAt);

		if (!Number.isFinite(savedAt) || Date.now() - savedAt > STORAGE_TTL_MS) {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	} catch (error) {
		window.localStorage.removeItem(STORAGE_KEY);
		console.warn("Corrupted saved state was cleared.", error);
	}
}

function readStoredState() {
	if (!storageAvailable) {
		return {};
	}

	let rawState = null;

	try {
		rawState = window.localStorage.getItem(STORAGE_KEY);
	} catch (error) {
		storageAvailable = false;
		console.warn("Local storage is unavailable. Starting with defaults.", error);
		return {};
	}

	if (!rawState) {
		return {};
	}

	try {
		const parsedState = JSON.parse(rawState);

		if (!parsedState || typeof parsedState !== "object") {
			return {};
		}

		return parsedState;
	} catch (error) {
		console.warn("Saved state could not be parsed. Starting with defaults.", error);
		return {};
	}
}

function normaliseSavedDevices(value) {
	if (!Array.isArray(value)) {
		return structuredClone(DEFAULT_DEVICES);
	}

	return value
		.filter((device) => device && typeof device === "object")
		.map((device) => {
			return {
				name: String(device.name || "").trim(),
				ip: String(device.ip || "").trim(),
				zone: String(device.zone || "").trim(),
				mac: String(device.mac || "").trim(),
				source: String(device.source || "").trim()
			};
		});
}

function normaliseSavedTestPath(value) {
	if (!value || typeof value !== "object") {
		return structuredClone(DEFAULT_TEST_PATH);
	}

	return {
		srcIndex: String(value.srcIndex ?? DEFAULT_TEST_PATH.srcIndex),
		dstIndex: String(value.dstIndex ?? DEFAULT_TEST_PATH.dstIndex)
	};
}

function normalisePathCriteria(value) {
	if (!value || typeof value !== "object") {
		return structuredClone(DEFAULT_PATH_CRITERIA);
	}

	return {
		protocol: normaliseProtocol(value.protocol),
		destPort: String(value.destPort || "").trim()
	};
}

function importBulkHosts() {
	const text = document.getElementById("bulkHostsInput")?.value || "";
	const format = document.getElementById("bulkImportFormat")?.value || "auto";
	const parsed = parseBulkHosts(text, format);
	const result = mergeDevices(parsed.devices);
	hostImportHasRun = hostImportHasRun || result.added > 0 || result.updated > 0;

	renderBulkImportResult({
		added: result.added,
		updated: result.updated,
		skipped: parsed.skipped.length + result.skipped,
		unresolved: result.unresolved,
		skippedLines: parsed.skipped
	});

	renderDeviceInputs();
	parseAndRender();
}

function importUciSubnetMappings() {
	const input = document.getElementById("uciSubnetInput");
	const result = document.getElementById("uciSubnetResult");
	const parsed = parseUciSubnetMappings(input?.value || "");

	if (parsed.mappings.length === 0) {
		if (result) {
			result.innerHTML = `<span class="warn">0</span> mappings imported. Paste firewall/network UCI export lines first.`;
		}

		return;
	}

	const existing = new Set(parseSubnetMappingLines(subnetMappingsText));
	parsed.mappings.forEach((mapping) => existing.add(mapping));
	subnetMappingsText = Array.from(existing).join("\n");
	subnetImportHasRun = true;
	renderSubnetMappings();
	parseAndRender();

	if (result) {
		result.innerHTML = `
			<span class="info">${parsed.mappings.length}</span> mappings imported,
			<span class="${parsed.skipped.length ? "warn" : "info"}">${parsed.skipped.length}</span> skipped
		`;
	}
}

function clearUciSubnetInput() {
	const input = document.getElementById("uciSubnetInput");
	const result = document.getElementById("uciSubnetResult");

	if (input) {
		input.value = "";
	}

	if (result) {
		result.innerHTML = "No UCI subnet import run yet.";
	}
}

function clearBulkImport() {
	const input = document.getElementById("bulkHostsInput");

	if (input) {
		input.value = "";
	}

	renderBulkImportResult({
		added: 0,
		updated: 0,
		skipped: 0,
		unresolved: 0,
		skippedLines: []
	});
}

function exportDevicesJson() {
	const text = JSON.stringify(devices, null, 2);
	writeExportOutput(text);
	downloadText("openwrt-firewall-devices.json", text, "application/json");
}

function exportDevicesCsv() {
	const header = "name,ip,zone,mac,source";
	const rows = devices.map((device) => {
		return [device.name, device.ip, device.zone, device.mac || "", device.source || ""]
			.map(csvEscape)
			.join(",");
	});
	const text = [header, ...rows].join("\n");
	writeExportOutput(text);
	downloadText("openwrt-firewall-devices.csv", text, "text/csv");
}

function exportSessionJson() {
	const text = JSON.stringify(buildStatePayload(), null, 2);
	writeExportOutput(text);
	downloadText("openwrt-firewall-session.json", text, "application/json");
}

function exportGraphPng() {
	if (!cy) {
		writeExportOutput("Graph is not available.");
		return;
	}

	const dataUrl = cy.png({
		bg: "#020617",
		full: true,
		scale: 2
	});
	const link = document.createElement("a");
	link.href = dataUrl;
	link.download = "openwrt-firewall-graph.png";
	link.click();
	writeExportOutput("Graph PNG exported.");
}

function importDataFile(event) {
	const file = event.target.files[0];

	if (!file) {
		return;
	}

	const reader = new FileReader();

	reader.onload = function(e) {
		const content = String(e.target.result || "");
		const imported = importDataContent(content, file.name);
		writeExportOutput(imported.message);
		event.target.value = "";
	};

	reader.readAsText(file);
}

function importDataContent(content, filename = "") {
	const trimmed = String(content || "").trim();

	if (!trimmed) {
		return { message: "Import file was empty." };
	}

	if (filename.endsWith(".csv") || looksLikeDeviceCsv(trimmed)) {
		const importedDevices = parseDeviceCsv(trimmed);
		const result = mergeDevices(importedDevices);
		sessionImportHasRun = true;
		hostImportHasRun = hostImportHasRun || result.added > 0 || result.updated > 0;
		renderDeviceInputs();
		parseAndRender();
		return { message: `Imported CSV: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.` };
	}

	try {
		const parsed = JSON.parse(trimmed);

		if (Array.isArray(parsed)) {
			const result = mergeDevices(normaliseSavedDevices(parsed));
			sessionImportHasRun = true;
			hostImportHasRun = hostImportHasRun || result.added > 0 || result.updated > 0;
			renderDeviceInputs();
			parseAndRender();
			return { message: `Imported device JSON: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.` };
		}

		if (parsed && typeof parsed === "object" && Array.isArray(parsed.devices)) {
			applyImportedSession(parsed);
			return { message: "Imported session JSON." };
		}
	} catch (error) {
		return { message: `Import failed: ${error.message}` };
	}

	return { message: "Import file did not contain supported JSON or CSV." };
}

function applyImportedSession(session) {
	const firewallInput = document.getElementById("firewallInput");
	const graphFilter = document.getElementById("graphFilter");

	if (firewallInput && typeof session.configText === "string") {
		firewallInput.value = session.configText;
	}

	devices = normaliseSavedDevices(session.devices);
	subnetMappingsText = typeof session.subnetMappingsText === "string" ? session.subnetMappingsText : subnetMappingsText;
	currentLayout = normaliseGraphLayout(session.graphLayout);
	selectedTestPath = normaliseSavedTestPath(session.testPath);
	selectedPathCriteria = normalisePathCriteria(session.pathCriteria);
	hostImportHasRun = Boolean(session.importState?.hostImportHasRun) || normaliseSavedDevices(session.devices).some((device) => device.source || device.mac);
	subnetImportHasRun = Boolean(session.importState?.subnetImportHasRun);
	sessionImportHasRun = true;
	graphPathHighlightRequested = false;

	if (graphFilter) {
		graphFilter.value = normaliseGraphFilter(session.graphFilter);
	}

	renderSubnetMappings();
	renderPathCriteria();
	renderDeviceInputs();
	parseAndRender();
}

function parseDeviceCsv(text) {
	const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
	const firstLine = lines[0] || "";
	const lowerHeader = firstLine.toLowerCase();
	const hasHeader = lowerHeader.includes("ip") && (lowerHeader.includes("name") || lowerHeader.includes("hostname"));
	const dataLines = hasHeader ? lines.slice(1) : lines;

	return dataLines.map((line) => {
		const parts = parseCsvLine(line);
		const device = hasHeader
			? mapCsvDeviceByHeader(parts, parseCsvLine(firstLine))
			: { name: parts[0], ip: parts[1], zone: parts[2], mac: parts[3], source: parts[4] };

		return normaliseImportedDevice(device);
	}).filter((device) => isValidIpv4(device.ip));
}

function looksLikeDeviceCsv(text) {
	const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
	const headers = parseCsvLine(firstLine).map((value) => value.toLowerCase());
	return headers.includes("ip") && (headers.includes("name") || headers.includes("hostname")) && headers.includes("zone");
}

function mapCsvDeviceByHeader(parts, header) {
	return header.reduce((result, key, index) => {
		const normalisedKey = String(key || "").trim().toLowerCase();
		const mappedKey = normalisedKey === "hostname" ? "name" : normalisedKey;
		result[mappedKey] = parts[index] || "";
		return result;
	}, {});
}

function parseCsvLine(line) {
	const values = [];
	let current = "";
	let quoted = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];

		if (char === '"' && line[index + 1] === '"') {
			current += '"';
			index += 1;
			continue;
		}

		if (char === '"') {
			quoted = !quoted;
			continue;
		}

		if (char === "," && !quoted) {
			values.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	values.push(current);
	return values.map((value) => value.trim());
}

function compareFirewallConfig() {
	const compareText = document.getElementById("compareFirewallInput")?.value || "";
	const container = document.getElementById("comparisonView");

	if (!container) {
		return;
	}

	if (!compareText.trim()) {
		container.innerHTML = `<p class="small">Paste a second firewall config before comparing.</p>`;
		return;
	}

	const otherModel = parseOpenWrtFirewall(compareText);
	const diff = diffFirewallModels(firewallModel, otherModel);

	container.innerHTML = `
		${renderDiffCard("Zones Added", diff.zonesAdded)}
		${renderDiffCard("Zones Removed", diff.zonesRemoved)}
		${renderDiffCard("Forwardings Added", diff.forwardingsAdded)}
		${renderDiffCard("Forwardings Removed", diff.forwardingsRemoved)}
		${renderDiffCard("Rules Added", diff.rulesAdded)}
		${renderDiffCard("Rules Removed", diff.rulesRemoved)}
	`;
}

function clearComparison() {
	const input = document.getElementById("compareFirewallInput");
	const output = document.getElementById("comparisonView");

	if (input) {
		input.value = "";
	}

	if (output) {
		output.innerHTML = "";
	}
}

function diffFirewallModels(current, next) {
	return {
		zonesAdded: diffSets(Object.keys(next.zones), Object.keys(current.zones)),
		zonesRemoved: diffSets(Object.keys(current.zones), Object.keys(next.zones)),
		forwardingsAdded: diffSets(next.forwardings.map(formatForwarding), current.forwardings.map(formatForwarding)),
		forwardingsRemoved: diffSets(current.forwardings.map(formatForwarding), next.forwardings.map(formatForwarding)),
		rulesAdded: diffSets(next.rules.map(formatRule), current.rules.map(formatRule)),
		rulesRemoved: diffSets(current.rules.map(formatRule), next.rules.map(formatRule))
	};
}

function renderDiffCard(title, values) {
	const body = values.length > 0
		? values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")
		: `<li class="small">None</li>`;

	return `
		<div class="finding low">
			<strong>${escapeHtml(title)}</strong>
			<ul>${body}</ul>
		</div>
	`;
}

function diffSets(left, right) {
	const rightSet = new Set(right);
	return left.filter((item) => !rightSet.has(item));
}

function formatForwarding(forwarding) {
	return `${forwarding.src || "any"} -> ${forwarding.dest || "any"}`;
}

function formatRule(rule) {
	return `${rule.name}|${rule.src}|${rule.dest}|${rule.srcIp}|${rule.destIp}|${rule.proto}|${rule.destPort}|${rule.target}`;
}

function writeExportOutput(text) {
	const output = document.getElementById("exportOutput");

	if (output) {
		output.value = text;
	}
}

function buildStatePayload() {
	return {
		version: 1,
		savedAt: Date.now(),
		configText: document.getElementById("firewallInput")?.value || "",
		devices,
		subnetMappingsText,
		graphLayout: currentLayout,
		graphFilter: getGraphFilterValue(),
		testPath: selectedTestPath,
		pathCriteria: selectedPathCriteria,
		importState: {
			hostImportHasRun,
			subnetImportHasRun,
			sessionImportHasRun
		},
		uiState: {
			importSectionCollapsed
		}
	};
}

function downloadText(filename, text, mimeType) {
	const blob = new Blob([text], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

function csvEscape(value) {
	const text = String(value || "");

	if (/[",\n]/.test(text)) {
		return `"${text.replaceAll('"', '""')}"`;
	}

	return text;
}

function parseUciSubnetMappings(text) {
	const firewallZones = {};
	const networkConfigs = {};
	const skipped = [];

	String(text || "").split(/\r?\n/).forEach((line) => {
		const parsed = parseUciAssignment(line);

		if (!parsed) {
			if (line.trim() && !line.trim().startsWith("#")) {
				skipped.push(line.trim());
			}

			return;
		}

		if (parsed.namespace === "firewall") {
			if (!firewallZones[parsed.section]) {
				firewallZones[parsed.section] = {};
			}

			firewallZones[parsed.section][parsed.option] = parsed.value;
		}

		if (parsed.namespace === "network") {
			if (!networkConfigs[parsed.section]) {
				networkConfigs[parsed.section] = {};
			}

			networkConfigs[parsed.section][parsed.option] = parsed.value;
		}
	});

	const mappings = [];

	Object.values(firewallZones).forEach((zoneConfig) => {
		const zoneName = zoneConfig.name || "";
		const networkNames = String(zoneConfig.network || "")
			.replaceAll("'", "")
			.split(/\s+/)
			.filter(Boolean);

		networkNames.forEach((networkName) => {
			const network = networkConfigs[networkName];

			if (!network || !network.ipaddr) {
				return;
			}

			const cidr = networkToCidr(network.ipaddr, network.netmask);

			if (cidr && zoneName) {
				mappings.push(`${cidr} ${zoneName}`);
			}
		});
	});

	return {
		mappings: Array.from(new Set(mappings)),
		skipped
	};
}

function parseUciAssignment(line) {
	const trimmed = String(line || "").trim();
	const match = trimmed.match(/^(firewall|network)\.([^.]+(?:\[[^\]]+\])?)\.([A-Za-z0-9_]+)=(.*)$/);

	if (!match) {
		return null;
	}

	return {
		namespace: match[1],
		section: match[2],
		option: match[3],
		value: stripQuotes(match[4])
	};
}

function stripQuotes(value) {
	return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function networkToCidr(ipaddr, netmask) {
	const ipNumber = ipv4ToNumber(ipaddr);

	if (ipNumber === null) {
		return "";
	}

	const prefix = netmaskToPrefix(netmask || "255.255.255.0");

	if (prefix === null) {
		return "";
	}

	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	const network = numberToIpv4((ipNumber & mask) >>> 0);
	return `${network}/${prefix}`;
}

function netmaskToPrefix(netmask) {
	const maskNumber = ipv4ToNumber(netmask);

	if (maskNumber === null) {
		return null;
	}

	const binary = maskNumber.toString(2).padStart(32, "0");

	if (!/^1*0*$/.test(binary)) {
		return null;
	}

	return binary.indexOf("0") === -1 ? 32 : binary.indexOf("0");
}

function numberToIpv4(value) {
	return [
		(value >>> 24) & 255,
		(value >>> 16) & 255,
		(value >>> 8) & 255,
		value & 255
	].join(".");
}

function parseSubnetMappingLines(text) {
	return String(text || "").split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseBulkHosts(text, format = "auto") {
	const subnetMappings = parseSubnetMappings(subnetMappingsText);
	const result = {
		devices: [],
		skipped: []
	};

	String(text || "").split(/\r?\n/).forEach((line, index) => {
		const parsed = parseHostLine(line, format, subnetMappings);

		if (parsed) {
			result.devices.push(parsed);
			return;
		}

		if (line.trim() && !line.trim().startsWith("#") && !isOpenWrtExportHeader(line)) {
			result.skipped.push(`Line ${index + 1}: ${line.trim()}`);
		}
	});

	return result;
}

function isOpenWrtExportHeader(line) {
	const headers = parseCsvLine(String(line || "").trim()).map((value) => value.toLowerCase());
	return headers[0] === "ip" && headers[1] === "hostname" && headers[2] === "zone" && headers[3] === "mac";
}

function parseHostLine(line, format = "auto", subnetMappings = []) {
	const trimmed = String(line || "").trim();

	if (!trimmed || trimmed.startsWith("#")) {
		return null;
	}

	if (format === "openwrt-export" || format === "auto") {
		const exported = parseOpenWrtExportCsvLine(trimmed);

		if (exported || format === "openwrt-export") {
			return exported;
		}
	}

	if (format === "dhcp" || format === "auto") {
		const dhcp = parseDhcpLeaseLine(trimmed, subnetMappings);

		if (dhcp || format === "dhcp") {
			return dhcp;
		}
	}

	if (format === "neighbour" || format === "auto") {
		const neighbour = parseNeighbourLine(trimmed, subnetMappings);

		if (neighbour || format === "neighbour") {
			return neighbour;
		}
	}

	return parseSimpleHostLine(trimmed, subnetMappings);
}

function parseOpenWrtExportCsvLine(line) {
	if (!line.includes(",")) {
		return null;
	}

	const parts = parseCsvLine(line);

	if (parts[0]?.toLowerCase() === "ip") {
		return null;
	}

	if (parts.length < 3 || !isValidIpv4(parts[0])) {
		return null;
	}

	return normaliseImportedDevice({
		ip: parts[0],
		name: parts[1] || parts[0],
		zone: parts[2] || "",
		mac: parts[3] || "",
		source: "openwrt-export"
	});
}

function parseSimpleHostLine(line, subnetMappings) {
	const parts = line.split(/\s+/);

	if (parts.length < 2) {
		return null;
	}

	let ip = "";
	let name = "";
	let zone = "";

	if (isValidIpv4(parts[0])) {
		ip = parts[0];
		name = parts[1] || parts[0];
		zone = parts[2] || "";
	} else if (isValidIpv4(parts[1])) {
		name = parts[0];
		ip = parts[1];
		zone = parts[2] || "";
	}

	if (!ip) {
		return null;
	}

	return normaliseImportedDevice({
		name,
		ip,
		zone: zone || inferZoneForIp(ip, subnetMappings),
		source: "host-list"
	});
}

function parseNeighbourLine(line, subnetMappings) {
	const arpMatch = line.match(/^(.*?)\s*\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:.-]+).*?\son\s+(\S+)/i);

	if (arpMatch && isValidIpv4(arpMatch[2])) {
		const name = arpMatch[1] && arpMatch[1] !== "?" ? arpMatch[1] : arpMatch[2];
		const zone = inferZoneForIp(arpMatch[2], subnetMappings) || zoneFromInterface(arpMatch[4]);

		return normaliseImportedDevice({
			name,
			ip: arpMatch[2],
			zone,
			mac: arpMatch[3],
			source: "arp"
		});
	}

	const parts = line.split(/\s+/);
	const ip = parts[0];
	const devIndex = parts.indexOf("dev");
	const macIndex = parts.indexOf("lladdr");

	if (!isValidIpv4(ip) || devIndex === -1) {
		return null;
	}

	const iface = parts[devIndex + 1] || "";
	const mac = macIndex !== -1 ? parts[macIndex + 1] || "" : "";
	const zone = inferZoneForIp(ip, subnetMappings) || zoneFromInterface(iface);

	return normaliseImportedDevice({
		name: ip,
		ip,
		zone,
		mac,
		source: "neighbour"
	});
}

function parseDhcpLeaseLine(line, subnetMappings) {
	const parts = line.split(/\s+/);

	if (parts.length < 3 || !/^\d+$/.test(parts[0]) || !isValidIpv4(parts[2])) {
		return null;
	}

	const hostname = parts[3] && parts[3] !== "*" ? parts[3] : parts[2];

	return normaliseImportedDevice({
		name: hostname,
		ip: parts[2],
		zone: inferZoneForIp(parts[2], subnetMappings),
		mac: parts[1] || "",
		source: "dhcp"
	});
}

function normaliseImportedDevice(device) {
	return {
		name: String(device.name || device.ip || "Imported Host").trim(),
		ip: String(device.ip || "").trim(),
		zone: String(device.zone || "").trim(),
		mac: String(device.mac || "").trim(),
		source: String(device.source || "import").trim()
	};
}

function mergeDevices(importedDevices) {
	const result = {
		added: 0,
		updated: 0,
		skipped: 0,
		unresolved: 0
	};
	const deviceByIp = new Map(devices.map((device, index) => [device.ip, { device, index }]));

	importedDevices.forEach((imported) => {
		if (!isValidIpv4(imported.ip)) {
			result.skipped += 1;
			return;
		}

		if (!imported.zone) {
			result.unresolved += 1;
		}

		const existing = deviceByIp.get(imported.ip);

		if (existing) {
			let changed = false;

			if ((!existing.device.name || existing.device.name === existing.device.ip) && imported.name) {
				existing.device.name = imported.name;
				changed = true;
			}

			if (!existing.device.zone && imported.zone) {
				existing.device.zone = imported.zone;
				changed = true;
			}

			if (!existing.device.mac && imported.mac) {
				existing.device.mac = imported.mac;
				changed = true;
			}

			if (changed) {
				result.updated += 1;
			}

			return;
		}

		devices.push({
			name: imported.name || imported.ip,
			ip: imported.ip,
			zone: imported.zone,
			mac: imported.mac,
			source: imported.source
		});
		result.added += 1;
	});

	return result;
}

function renderBulkImportResult(result) {
	const container = document.getElementById("bulkImportResult");

	if (!container) {
		return;
	}

	const skippedLines = result.skippedLines && result.skippedLines.length > 0
		? `<br><span class="small">${escapeHtml(result.skippedLines.slice(0, 3).join(" | "))}</span>`
		: "";

	container.innerHTML = `
		<span class="info">${result.added}</span> added,
		<span class="info">${result.updated}</span> updated,
		<span class="${result.unresolved ? "warn" : "info"}">${result.unresolved}</span> unresolved,
		<span class="${result.skipped ? "warn" : "info"}">${result.skipped}</span> skipped
		${skippedLines}
	`;
}

function parseSubnetMappings(text) {
	return String(text || "").split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const parts = line.split(/\s+/);
			const cidr = parseCidr(parts[0]);

			if (!cidr || !parts[1]) {
				return null;
			}

			return {
				...cidr,
				zone: parts[1]
			};
		})
		.filter(Boolean);
}

function inferZoneForIp(ip, subnetMappings = parseSubnetMappings(subnetMappingsText)) {
	const ipNumber = ipv4ToNumber(ip);

	if (ipNumber === null) {
		return "";
	}

	const match = subnetMappings.find((mapping) => {
		return ((ipNumber & mapping.mask) >>> 0) === mapping.network;
	});

	return match ? match.zone : "";
}

function parseCidr(value) {
	const match = String(value || "").match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);

	if (!match) {
		return null;
	}

	const ipNumber = ipv4ToNumber(match[1]);
	const prefix = Number(match[2]);

	if (ipNumber === null || prefix < 0 || prefix > 32) {
		return null;
	}

	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

	return {
		network: (ipNumber & mask) >>> 0,
		mask,
		prefix
	};
}

function isValidIpv4(value) {
	return ipv4ToNumber(value) !== null;
}

function ipv4ToNumber(value) {
	const parts = String(value || "").split(".");

	if (parts.length !== 4) {
		return null;
	}

	const octets = parts.map((part) => Number(part));

	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return null;
	}

	return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function zoneFromInterface(iface) {
	return String(iface || "")
		.replace(/^br-/, "")
		.replace(/^eth\d+\./, "")
		.replace(/^wlan\d+-/, "")
		.trim();
}

function updateSelectedTestPathFromSelectors() {
	const srcSelect = document.getElementById("srcDevice");
	const dstSelect = document.getElementById("dstDevice");

	selectedTestPath = {
		srcIndex: srcSelect?.value || selectedTestPath.srcIndex,
		dstIndex: dstSelect?.value || selectedTestPath.dstIndex
	};

	normaliseSelectedTestPath();
}

function updatePathCriteriaFromInputs() {
	selectedPathCriteria = {
		protocol: normaliseProtocol(document.getElementById("pathProtocol")?.value),
		destPort: String(document.getElementById("pathDestPort")?.value || "").trim()
	};
}

function normaliseSelectedTestPath() {
	const fallbackSrcIndex = devices.length > 0 ? "0" : "";
	const fallbackDstIndex = devices.length > 1 ? "1" : fallbackSrcIndex;

	selectedTestPath = {
		srcIndex: isValidDeviceIndex(selectedTestPath.srcIndex) ? String(Number(selectedTestPath.srcIndex)) : fallbackSrcIndex,
		dstIndex: isValidDeviceIndex(selectedTestPath.dstIndex) ? String(Number(selectedTestPath.dstIndex)) : fallbackDstIndex
	};
}

function isValidDeviceIndex(value) {
	if (value === "" || value === null || value === undefined) {
		return false;
	}

	const index = Number(value);
	return Number.isInteger(index) && index >= 0 && index < devices.length;
}

function getGraphFilterValue() {
	return normaliseGraphFilter(document.getElementById("graphFilter")?.value);
}

function normaliseGraphFilter(value) {
	return VALID_GRAPH_FILTERS.includes(value) ? value : "all";
}

function normaliseGraphLayout(value) {
	return VALID_GRAPH_LAYOUTS.includes(value) ? value : "cose";
}

function normaliseProtocol(value) {
	const protocol = String(value || "").trim().toLowerCase();
	return ["tcp", "udp", "icmp"].includes(protocol) ? protocol : "";
}

function ruleProtocolMatches(ruleProto, criteriaProtocol) {
	const protocol = normaliseProtocol(criteriaProtocol);

	if (!protocol) {
		return true;
	}

	const ruleProtocols = String(ruleProto || "")
		.toLowerCase()
		.split(/[\s,]+/)
		.filter(Boolean);

	if (ruleProtocols.length === 0 || ruleProtocols.includes("all")) {
		return true;
	}

	if (ruleProtocols.includes("tcpudp")) {
		return protocol === "tcp" || protocol === "udp";
	}

	return ruleProtocols.includes(protocol);
}

function rulePortMatches(ruleDestPort, criteriaDestPort) {
	const port = Number(String(criteriaDestPort || "").trim());

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return true;
	}

	const rulePortText = String(ruleDestPort || "").trim();

	if (!rulePortText) {
		return true;
	}

	return rulePortText
		.split(/[\s,]+/)
		.filter(Boolean)
		.some((part) => portExpressionMatches(part, port));
}

function portExpressionMatches(expression, port) {
	const rangeMatch = String(expression).match(/^(\d+)-(\d+)$/);

	if (rangeMatch) {
		const start = Number(rangeMatch[1]);
		const end = Number(rangeMatch[2]);
		return Number.isInteger(start) && Number.isInteger(end) && port >= start && port <= end;
	}

	return Number(expression) === port;
}

function formatPathCriteria(criteria) {
	const pathCriteria = normalisePathCriteria(criteria);
	const protocol = pathCriteria.protocol ? pathCriteria.protocol.toUpperCase() : "Any protocol";
	const port = pathCriteria.destPort ? `port ${pathCriteria.destPort}` : "any port";
	return `${protocol} / ${port}`;
}

function setCurrentYear() {
	const yearElement = document.getElementById(CURRENT_YEAR_ID);

	if (!yearElement) {
		return;
	}

	yearElement.textContent = String(new Date().getFullYear());
}

function debounce(fn, delay) {
	let timeoutId = null;

	return function debounced(...args) {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => fn.apply(this, args), delay);
	};
}

function parseOpenWrtFirewall(text) {
	const sections = [];
	let current = null;

	text.split(/\r?\n/).forEach((line) => {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) {
			return;
		}

		const configMatch = trimmed.match(/^config\s+(\S+)(?:\s+'?([^']+)'?)?/);

		if (configMatch) {
			current = {
				type: configMatch[1],
				name: configMatch[2] || "",
				options: {},
				lists: {}
			};

			sections.push(current);
			return;
		}

		if (!current) {
			return;
		}

		const optionMatch = trimmed.match(/^option\s+(\S+)\s+'?([^']*)'?/);
		const listMatch = trimmed.match(/^list\s+(\S+)\s+'?([^']*)'?/);

		if (optionMatch) {
			current.options[optionMatch[1]] = optionMatch[2];
		}

		if (listMatch) {
			const key = listMatch[1];

			if (!current.lists[key]) {
				current.lists[key] = [];
			}

			current.lists[key].push(listMatch[2]);
		}
	});

	const model = {
		zones: {},
		forwardings: [],
		rules: []
	};

	sections.forEach((section) => {
		if (section.type === "zone") {
			const zoneName = section.options.name || section.name;

			model.zones[zoneName] = {
				name: zoneName,
				input: section.options.input || "REJECT",
				output: section.options.output || "REJECT",
				forward: section.options.forward || "REJECT",
				networks: section.lists.network || []
			};
		}

		if (section.type === "forwarding") {
			model.forwardings.push({
				src: section.options.src || "",
				dest: section.options.dest || ""
			});
		}

		if (section.type === "rule") {
			const unsupportedFields = Object.keys(section.options).filter((key) => {
				return !SUPPORTED_RULE_FIELDS.includes(key);
			});

			model.rules.push({
				index: model.rules.length + 1,
				name: section.options.name || section.name || "Unnamed rule",
				src: section.options.src || "",
				dest: section.options.dest || "",
				srcIp: section.options.src_ip || "",
				destIp: section.options.dest_ip || "",
				proto: section.options.proto || "",
				destPort: section.options.dest_port || "",
				target: section.options.target || "",
				unsupportedFields
			});
		}
	});

	return model;
}

function renderSummary() {
	const zoneCount = Object.keys(firewallModel.zones).length;
	const forwardingCount = firewallModel.forwardings.length;
	const ruleCount = firewallModel.rules.length;
	const deviceCount = devices.length;

	document.getElementById("summaryView").innerHTML = `
		<div class="summary-card">
			<strong>${zoneCount}</strong>
			<span class="small">Firewall zones</span>
		</div>
		<div class="summary-card">
			<strong>${forwardingCount}</strong>
			<span class="small">Zone forwardings</span>
		</div>
		<div class="summary-card">
			<strong>${ruleCount}</strong>
			<span class="small">Traffic rules</span>
		</div>
		<div class="summary-card">
			<strong>${deviceCount}</strong>
			<span class="small">Mapped devices</span>
		</div>
	`;
}

function renderZoneView() {
	const container = document.getElementById("zoneView");
	container.innerHTML = "";

	const zones = Object.values(firewallModel.zones);

	if (zones.length === 0) {
		container.innerHTML = `<p class="small">No zones detected. Paste an OpenWrt firewall config and click Parse.</p>`;
		return;
	}

	zones.forEach((zone) => {
		const zoneDevices = devices.filter((device) => device.zone === zone.name);

		const card = document.createElement("div");
		card.className = "zone-card";

		card.innerHTML = `
			<div class="zone-header">
				<h3>${escapeHtml(zone.name)}</h3>
				<span class="badge">${escapeHtml(zone.networks.join(", ") || "no network")}</span>
			</div>

			<p class="small">
				Input: <strong>${escapeHtml(zone.input)}</strong> |
				Output: <strong>${escapeHtml(zone.output)}</strong> |
				Forward: <strong>${escapeHtml(zone.forward)}</strong>
			</p>

			${zoneDevices.map((device) => {
				const riskClass = zone.name.toLowerCase().includes("iot") ? "iot-risk" : "";

				return `
					<div class="device ${riskClass}">
						<strong>📱 ${escapeHtml(device.name)}</strong>
						<span class="small">${escapeHtml(device.ip)}</span>
					</div>
				`;
			}).join("") || `<p class="small">No devices mapped to this zone.</p>`}
		`;

		container.appendChild(card);
	});
}

function renderMatrix() {
	const zones = Object.keys(firewallModel.zones);
	const container = document.getElementById("matrixView");

	if (zones.length === 0) {
		container.innerHTML = `<p class="small">No zones detected.</p>`;
		return;
	}

	let html = `<table class="matrix"><thead><tr><th>From / To</th>`;

	zones.forEach((zone) => {
		html += `<th>${escapeHtml(zone)}</th>`;
	});

	html += `</tr></thead><tbody>`;

	zones.forEach((src) => {
		html += `<tr><th>${escapeHtml(src)}</th>`;

		zones.forEach((dest) => {
			const decision = evaluateZonePath(src, dest);
			html += `<td class="${decision.allowed ? "allow" : "deny"}">${decision.allowed ? "ALLOW" : "DENY"}</td>`;
		});

		html += `</tr>`;
	});

	html += `</tbody></table>`;
	container.innerHTML = html;
}

function renderDeviceSelectors() {
	const srcSelect = document.getElementById("srcDevice");
	const dstSelect = document.getElementById("dstDevice");

	if (!srcSelect || !dstSelect) {
		return;
	}

	normaliseSelectedTestPath();

	const options = devices.map((device, index) => {
		return `<option value="${index}">${escapeHtml(device.name)} (${escapeHtml(device.zone)})</option>`;
	}).join("");

	srcSelect.innerHTML = options;
	dstSelect.innerHTML = options;

	srcSelect.value = selectedTestPath.srcIndex;
	dstSelect.value = selectedTestPath.dstIndex;
}

function renderRelationshipMap() {
	const container = document.getElementById("relationshipView");
	container.innerHTML = "";

	if (devices.length < 2) {
		container.innerHTML = `<p class="small">Add at least two devices to see relationships.</p>`;
		return;
	}

	const relationships = buildDeviceRelationships();
	const visibleRelationships = relationshipMapExpanded
		? relationships
		: relationships.slice(0, RELATIONSHIP_PREVIEW_LIMIT);

	visibleRelationships.forEach((item) => {
		const div = document.createElement("div");
		div.className = `relationship ${item.decision.allowed ? "allowed" : "blocked"}`;
		div.tabIndex = 0;
		div.setAttribute("role", "button");
		div.addEventListener("click", () => selectRelationshipPath(item.srcIndex, item.dstIndex));
		div.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				selectRelationshipPath(item.srcIndex, item.dstIndex);
			}
		});

		div.innerHTML = `
			<strong>${item.decision.allowed ? "✅ ALLOWED" : "⛔ BLOCKED"}</strong>
			<p>
				${escapeHtml(item.src.name)}
				<span class="small">(${escapeHtml(item.src.zone)} / ${escapeHtml(item.src.ip)})</span>
				<br>
				➡️ ${escapeHtml(item.dst.name)}
				<span class="small">(${escapeHtml(item.dst.zone)} / ${escapeHtml(item.dst.ip)})</span>
			</p>
			<p class="small">${escapeHtml(item.decision.reason)}</p>
		`;

		container.appendChild(div);
	});

	if (relationships.length > RELATIONSHIP_PREVIEW_LIMIT) {
		const row = document.createElement("div");
		row.className = "show-more-row";
		row.innerHTML = `
			<button onclick="toggleRelationshipMapExpanded()">
				${relationshipMapExpanded ? "Show fewer relationships" : `Show all ${relationships.length} relationships`}
			</button>
		`;
		container.appendChild(row);
	}
}

function toggleRelationshipMapExpanded() {
	relationshipMapExpanded = !relationshipMapExpanded;
	renderRelationshipMap();
}

function renderAnalysisFindings() {
	const container = document.getElementById("analysisView");

	if (!container) {
		return;
	}

	const findings = buildAnalysisFindings();

	if (findings.length === 0) {
		container.innerHTML = `<p class="small">No relationship findings detected for the current model.</p>`;
		return;
	}

	container.innerHTML = findings.map((finding) => {
		return `
			<div class="finding ${escapeHtml(finding.severity)}">
				<strong>${escapeHtml(finding.title)}</strong>
				<p class="small">${escapeHtml(finding.detail)}</p>
			</div>
		`;
	}).join("");
}

function buildAnalysisFindings() {
	const findings = [];
	const zones = Object.keys(firewallModel.zones);

	devices.forEach((src) => {
		devices.forEach((dst) => {
			if (src === dst) {
				return;
			}

			const decision = evaluateDevicePath(src, dst);
			const srcRole = classifyZone(src.zone);
			const dstRole = classifyZone(dst.zone);

			if (!decision.allowed) {
				return;
			}

			if (src.zone === dst.zone && srcRole === "iot") {
				addFinding(findings, "high", "IoT east-west communication", `${src.name} can reach ${dst.name} inside ${src.zone}. ${decision.reason}`);
			}

			if (srcRole === "guest" && dstRole === "lan") {
				addFinding(findings, "high", "Guest to LAN exposure", `${src.name} can reach ${dst.name}. ${decision.reason}`);
			}

			if (srcRole === "guest" && dstRole === "server") {
				addFinding(findings, "high", "Guest to server exposure", `${src.name} can reach ${dst.name}. ${decision.reason}`);
			}

			if (srcRole === "server" && dstRole === "iot") {
				addFinding(findings, "medium", "Server to IoT exposure", `${src.name} can reach ${dst.name}. ${decision.reason}`);
			}
		});
	});

	zones.forEach((zone) => {
		const model = firewallModel.zones[zone];

		if (normaliseTarget(model.forward) === "ACCEPT") {
			addFinding(findings, "medium", "Zone with unrestricted forwarding", `${zone} has forward policy ACCEPT.`);
		}

		const outboundForwardings = firewallModel.forwardings.filter((forwarding) => forwarding.src === zone);

		if (outboundForwardings.length > Math.max(1, zones.length / 2)) {
			addFinding(findings, "medium", "Excessive zone trust", `${zone} forwards to ${outboundForwardings.map((item) => item.dest).join(", ")}.`);
		}
	});

	if (zones.length > 2) {
		const fullMesh = zones.every((src) => {
			return zones.every((dst) => src === dst || evaluateZonePath(src, dst).allowed);
		});

		if (fullMesh) {
			addFinding(findings, "high", "Full mesh zone communication", "Every zone can reach every other zone.");
		}
	}

	firewallModel.rules.forEach((rule) => {
		const target = normaliseTarget(rule.target);
		const srcRole = classifyZone(rule.src);
		const dstRole = classifyZone(rule.dest);

		if (target === "ACCEPT" && (srcRole === "iot" || srcRole === "guest") && dstRole !== "wan") {
			addFinding(findings, "medium", "Device exception bypassing segmentation", `Rule #${rule.index} ${rule.name} allows ${rule.src || "any"} to ${rule.dest || "any"}.`);
		}

		if (rule.unsupportedFields && rule.unsupportedFields.length > 0) {
			addFinding(findings, "low", "Unsupported rule fields present", `Rule #${rule.index} ${rule.name} includes unsupported fields: ${rule.unsupportedFields.join(", ")}.`);
		}
	});

	return findings;
}

function addFinding(findings, severity, title, detail) {
	const key = `${severity}:${title}:${detail}`;

	if (findings.some((finding) => finding.key === key)) {
		return;
	}

	findings.push({
		key,
		severity,
		title,
		detail
	});
}

function classifyZone(zoneName) {
	const zone = String(zoneName || "").toLowerCase();

	if (zone.includes("guest")) {
		return "guest";
	}

	if (zone.includes("iot")) {
		return "iot";
	}

	if (zone.includes("server") || zone.includes("srv") || zone.includes("dmz")) {
		return "server";
	}

	if (zone.includes("lan")) {
		return "lan";
	}

	if (zone.includes("wan")) {
		return "wan";
	}

	return "other";
}

function renderGraph(layoutName = null) {
	if (layoutName) {
		currentLayout = normaliseGraphLayout(layoutName);
		saveState();
	}

	const elements = buildGraphElements();
	const container = document.getElementById("cy");

	if (!window.cytoscape) {
		container.innerHTML = "Cytoscape.js failed to load. Check internet/CDN access.";
		return;
	}

	if (cy) {
		cy.destroy();
	}

	cy = cytoscape({
		container,
		elements,
		style: [
			{
				selector: "node",
				style: {
					"label": "data(label)",
					"text-valign": "center",
					"text-halign": "center",
					"color": "#e5e7eb",
					"font-size": "11px",
					"text-wrap": "wrap",
					"text-max-width": "95px",
					"border-width": 2,
					"border-color": "#374151",
					"background-color": "#64748b",
					"width": 62,
					"height": 62
				}
			},
			{
				selector: "node[type = 'zone']",
				style: {
					"shape": "round-rectangle",
					"background-color": "#0284c7",
					"width": 95,
					"height": 55,
					"font-weight": "700"
				}
			},
			{
				selector: "node[type = 'device']",
				style: {
					"shape": "ellipse",
					"background-color": "#7c3aed",
					"width": 72,
					"height": 72
				}
			},
			{
				selector: "edge",
				style: {
					"label": "data(label)",
					"font-size": "9px",
					"color": "#9ca3af",
					"text-background-color": "#020617",
					"text-background-opacity": 0.85,
					"text-background-padding": "3px",
					"curve-style": "bezier",
					"target-arrow-shape": "triangle",
					"target-arrow-color": "#9ca3af",
					"line-color": "#9ca3af",
					"width": 2
				}
			},
			{
				selector: "edge[type = 'membership']",
				style: {
					"line-color": "#64748b",
					"target-arrow-color": "#64748b",
					"line-style": "dotted",
					"label": "in zone",
					"width": 1.5
				}
			},
			{
				selector: "edge[decision = 'allowed']",
				style: {
					"line-color": "#22c55e",
					"target-arrow-color": "#22c55e",
					"width": 3
				}
			},
			{
				selector: "edge[decision = 'blocked']",
				style: {
					"line-color": "#ef4444",
					"target-arrow-color": "#ef4444",
					"line-style": "dashed",
					"width": 2
				}
			},
			{
				selector: ".highlighted",
				style: {
					"border-color": "#facc15",
					"border-width": 4
				}
			},
			{
				selector: ".faded",
				style: {
					"opacity": 0.22
				}
			}
		],
		layout: getGraphLayout(currentLayout),
		wheelSensitivity: 0.2
	});

	cy.on("tap", "node", function(event) {
		highlightNodeRelationships(event.target);
	});

	cy.on("tap", function(event) {
		if (event.target === cy) {
			cy.elements().removeClass("highlighted faded");
		}
	});
}

function handleGraphFilterChange() {
	renderGraph();
	renderCurrentTestResult(false, { highlight: graphPathHighlightRequested });
	saveState();
}

function buildGraphElements() {
	const filter = document.getElementById("graphFilter")?.value || "all";
	const elements = [];
	const zones = Object.values(firewallModel.zones);

	zones.forEach((zone) => {
		elements.push({
			data: {
				id: zoneNodeId(zone.name),
				label: `Zone: ${zone.name}`,
				type: "zone",
				rawName: zone.name
			}
		});
	});

	devices.forEach((device, index) => {
		elements.push({
			data: {
				id: deviceNodeId(index),
				label: `${device.name}\n${device.ip}`,
				type: "device",
				rawName: device.name,
				zone: device.zone,
				ip: device.ip
			}
		});
	});

	if (filter === "all" || filter === "zones") {
		buildZoneRelationshipEdges().forEach((edge) => {
			if (filterEdge(edge, filter)) {
				elements.push(edge);
			}
		});
	}

	if (filter === "all" || filter === "devices" || filter === "allowed" || filter === "blocked") {
		buildDeviceRelationshipEdges().forEach((edge) => {
			if (filterEdge(edge, filter)) {
				elements.push(edge);
			}
		});
	}

	if (filter === "all" || filter === "zones" || filter === "devices") {
		devices.forEach((device, index) => {
			if (!firewallModel.zones[device.zone]) {
				return;
			}

			elements.push({
				data: {
					id: `membership-${index}`,
					source: deviceNodeId(index),
					target: zoneNodeId(device.zone),
					type: "membership",
					decision: "membership",
					label: "in zone"
				}
			});
		});
	}

	return elements;
}

function buildZoneRelationshipEdges() {
	const edges = [];
	const zones = Object.keys(firewallModel.zones);

	zones.forEach((src) => {
		zones.forEach((dst) => {
			if (src === dst) {
				return;
			}

			const decision = evaluateZonePath(src, dst);

			edges.push({
				data: {
					id: `zone-${src}-to-${dst}`,
					source: zoneNodeId(src),
					target: zoneNodeId(dst),
					type: "zone-relationship",
					decision: decision.allowed ? "allowed" : "blocked",
					label: decision.allowed ? "ALLOW" : "DENY",
					reason: decision.reason
				}
			});
		});
	});

	return edges;
}

function buildDeviceRelationshipEdges() {
	const edges = [];
	const relationships = buildDeviceRelationships();

	relationships.forEach((item, index) => {
		edges.push({
			data: {
				id: `device-${index}`,
				source: deviceNodeId(item.srcIndex),
				target: deviceNodeId(item.dstIndex),
				type: "device-relationship",
				decision: item.decision.allowed ? "allowed" : "blocked",
				label: item.decision.allowed ? "ALLOW" : "DENY",
				reason: item.decision.reason
			}
		});
	});

	return edges;
}

function buildDeviceRelationships() {
	const relationships = [];

	devices.forEach((src, srcIndex) => {
		devices.forEach((dst, dstIndex) => {
			if (srcIndex === dstIndex) {
				return;
			}

			const decision = evaluateDevicePath(src, dst);

			relationships.push({
				src,
				dst,
				srcIndex,
				dstIndex,
				decision
			});
		});
	});

	return relationships;
}

function filterEdge(edge, filter) {
	if (filter === "all") {
		return true;
	}

	if (filter === "allowed") {
		return edge.data.decision === "allowed";
	}

	if (filter === "blocked") {
		return edge.data.decision === "blocked";
	}

	if (filter === "zones") {
		return edge.data.type === "zone-relationship" || edge.data.type === "membership";
	}

	if (filter === "devices") {
		return edge.data.type === "device-relationship" || edge.data.type === "membership";
	}

	return true;
}

function getGraphLayout(layoutName) {
	if (layoutName === "circle") {
		return {
			name: "circle",
			padding: 50,
			animate: true
		};
	}

	if (layoutName === "breadthfirst") {
		return {
			name: "breadthfirst",
			directed: true,
			padding: 50,
			spacingFactor: 1.25,
			animate: true
		};
	}

	return {
		name: "cose",
		padding: 50,
		animate: true,
		nodeRepulsion: 9000,
		idealEdgeLength: 120,
		edgeElasticity: 120,
		gravity: 0.25,
		numIter: 1200
	};
}

function fitGraph() {
	if (!cy) {
		return;
	}

	cy.fit(undefined, 50);
}

function highlightNodeRelationships(node) {
	const connectedEdges = node.connectedEdges();
	const connectedNodes = connectedEdges.connectedNodes();

	cy.elements().addClass("faded");
	node.removeClass("faded").addClass("highlighted");
	connectedEdges.removeClass("faded").addClass("highlighted");
	connectedNodes.removeClass("faded").addClass("highlighted");
}

function selectRelationshipPath(srcIndex, dstIndex) {
	selectedTestPath = {
		srcIndex: String(srcIndex),
		dstIndex: String(dstIndex)
	};
	graphPathHighlightRequested = true;
	renderDeviceSelectors();
	testDevicePath(true, { highlight: true });
}

function renderCurrentTestResult(persist = true, options = {}) {
	const result = document.getElementById("testResult");
	const shouldHighlight = options.highlight === true;

	if (!result) {
		return;
	}

	if (devices.length === 0) {
		result.innerHTML = "Add a device to test traffic between devices.";

		if (persist) {
			saveState();
		}

		return;
	}

	testDevicePath(persist, { highlight: shouldHighlight });
}

function testDevicePath(persist = true, options = {}) {
	const shouldHighlight = options.highlight !== false;
	const srcIndex = document.getElementById("srcDevice").value;
	const dstIndex = document.getElementById("dstDevice").value;

	updatePathCriteriaFromInputs();
	selectedTestPath = {
		srcIndex,
		dstIndex
	};
	graphPathHighlightRequested = shouldHighlight;

	const src = devices[srcIndex];
	const dst = devices[dstIndex];

	if (!src || !dst) {
		document.getElementById("testResult").innerHTML = "Select two devices and test whether traffic is allowed.";

		if (persist) {
			saveState();
		}

		return;
	}

	const decision = evaluateDevicePath(src, dst, selectedPathCriteria);
	const criteriaLabel = formatPathCriteria(selectedPathCriteria);

	document.getElementById("testResult").innerHTML = `
		<strong class="${decision.allowed ? "allow" : "deny"}">
			${decision.allowed ? "✅ ALLOWED" : "⛔ BLOCKED"}
		</strong>
		<br>
		${escapeHtml(src.name)} (${escapeHtml(src.ip)} / ${escapeHtml(src.zone)})
		➡️
		${escapeHtml(dst.name)} (${escapeHtml(dst.ip)} / ${escapeHtml(dst.zone)})
		<br>
		<span class="small">${escapeHtml(criteriaLabel)}</span>
		<br>
		<span class="small">${escapeHtml(decision.reason)}</span>
	`;

	if (shouldHighlight) {
		highlightTestedPath(Number(srcIndex), Number(dstIndex));
	}

	if (persist) {
		saveState();
	}
}

function highlightTestedPath(srcIndex, dstIndex) {
	if (!cy) {
		return;
	}

	const srcId = deviceNodeId(srcIndex);
	const dstId = deviceNodeId(dstIndex);

	const edge = cy.edges().filter((item) => {
		return item.source().id() === srcId && item.target().id() === dstId;
	});

	cy.elements().addClass("faded");
	cy.getElementById(srcId).removeClass("faded").addClass("highlighted");
	cy.getElementById(dstId).removeClass("faded").addClass("highlighted");
	edge.removeClass("faded").addClass("highlighted");
}

function evaluateDevicePath(srcDevice, dstDevice, criteria = {}) {
	const pathCriteria = normalisePathCriteria(criteria);
	const matchingSpecificRule = findMatchingSpecificRule(srcDevice, dstDevice, pathCriteria);

	if (matchingSpecificRule) {
		const target = normaliseTarget(matchingSpecificRule.target);

		return {
			allowed: target === "ACCEPT",
			target,
			reason: `Matched rule #${matchingSpecificRule.index}: ${matchingSpecificRule.name} (${target || "unspecified target"})`
		};
	}

	const zoneDecision = evaluateZonePath(srcDevice.zone, dstDevice.zone);

	return {
		allowed: zoneDecision.allowed,
		reason: zoneDecision.reason
	};
}

function evaluateZonePath(srcZone, dstZone) {
	if (srcZone === dstZone) {
		const zone = firewallModel.zones[srcZone];

		if (!zone) {
			return {
				allowed: false,
				reason: `Unknown zone: ${srcZone}`
			};
		}

		return {
			allowed: normaliseTarget(zone.forward) === "ACCEPT",
			reason: `Same-zone traffic uses the '${srcZone}' forward policy (${zone.forward})`
		};
	}

	const forwarding = firewallModel.forwardings.find((item) => {
		return item.src === srcZone && item.dest === dstZone;
	});

	if (forwarding) {
		return {
			allowed: true,
			reason: `Zone forwarding exists: ${srcZone} → ${dstZone}`
		};
	}

	return {
		allowed: false,
		reason: `No zone forwarding found: ${srcZone} → ${dstZone}`
	};
}

function findMatchingSpecificRule(srcDevice, dstDevice, criteria = {}) {
	const pathCriteria = normalisePathCriteria(criteria);

	return firewallModel.rules.find((rule) => {
		const srcZoneMatches = !rule.src || rule.src === srcDevice.zone;
		const dstZoneMatches = !rule.dest || rule.dest === dstDevice.zone;
		const srcIpMatches = !rule.srcIp || rule.srcIp === srcDevice.ip;
		const dstIpMatches = !rule.destIp || rule.destIp === dstDevice.ip;
		const protocolMatches = ruleProtocolMatches(rule.proto, pathCriteria.protocol);
		const destPortMatches = rulePortMatches(rule.destPort, pathCriteria.destPort);

		return srcZoneMatches && dstZoneMatches && srcIpMatches && dstIpMatches && protocolMatches && destPortMatches;
	});
}

function zoneNodeId(zoneName) {
	return `zone-${safeId(zoneName)}`;
}

function deviceNodeId(index) {
	return `device-${index}`;
}

function safeId(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-");
}

function normaliseTarget(value) {
	return String(value || "").trim().toUpperCase();
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

main();
