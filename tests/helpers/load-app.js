const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../../public/assets/js/app.js");

const EXPOSED_NAMES = [
	"EXAMPLE_FIREWALL",
	"DEFAULT_DEVICES",
	"DEFAULT_SUBNET_MAPPINGS",
	"STORAGE_KEY",
	"STORAGE_TTL_MS",
	"buildStatePayload",
	"clearExpiredState",
	"evaluateDevicePath",
	"evaluateZonePath",
	"inferZoneForIp",
	"isValidIpv4",
	"mergeDevices",
	"networkToCidr",
	"normalisePathCriteria",
	"normaliseSavedDevices",
	"parseBulkHosts",
	"parseCidr",
	"parseDeviceCsv",
	"parseOpenWrtFirewall",
	"parseSubnetMappings",
	"parseUciSubnetMappings",
	"readStoredState",
	"renderImportSectionCollapsed",
	"rulePortMatches",
	"ruleProtocolMatches"
];

function createElement(id = "") {
	const classValues = new Set();

	return {
		id,
		value: "",
		innerHTML: "",
		textContent: "",
		children: [],
		attributes: {},
		style: {},
		classList: {
			values: classValues,
			add(name) {
				classValues.add(name);
			},
			remove(name) {
				classValues.delete(name);
			},
			contains(name) {
				return classValues.has(name);
			},
			toggle(name, force) {
				const shouldAdd = force === undefined ? !classValues.has(name) : Boolean(force);

				if (shouldAdd) {
					classValues.add(name);
				} else {
					classValues.delete(name);
				}

				return shouldAdd;
			}
		},
		addEventListener() {},
		appendChild(child) {
			this.children.push(child);
			return child;
		},
		click() {},
		setAttribute(name, value) {
			this.attributes[name] = String(value);
		}
	};
}

function createLocalStorage(initialState = {}) {
	const data = new Map(Object.entries(initialState).map(([key, value]) => [key, String(value)]));

	return {
		data,
		getItem(key) {
			return data.has(key) ? data.get(key) : null;
		},
		setItem(key, value) {
			data.set(key, String(value));
		},
		removeItem(key) {
			data.delete(key);
		},
		clear() {
			data.clear();
		}
	};
}

function loadApp(options = {}) {
	const elements = new Map(Object.entries(options.elements || {}));
	const localStorage = createLocalStorage(options.localStorage || {});
	const document = {
		createElement: (tagName) => createElement(tagName),
		getElementById: (id) => elements.get(id) || null
	};
	const sandbox = {
		__appExports: {},
		Blob,
		FileReader: function FileReader() {},
		URL: {
			createObjectURL: () => "blob:test",
			revokeObjectURL: () => {}
		},
		clearTimeout,
		confirm: () => true,
		console: {
			error: console.error,
			log: console.log,
			warn: () => {}
		},
		document,
		setTimeout,
		structuredClone,
		window: {
			addEventListener() {},
			clearTimeout,
			localStorage,
			setTimeout
		}
	};

	const source = fs.readFileSync(APP_PATH, "utf8").replace(/\nmain\(\);\s*$/, "");
	const hasOwn = "const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);";
	const setters = `
${hasOwn}
function __setState(nextState = {}) {
	if (hasOwn(nextState, "devices")) devices = nextState.devices;
	if (hasOwn(nextState, "subnetMappingsText")) subnetMappingsText = nextState.subnetMappingsText;
	if (hasOwn(nextState, "firewallModel")) firewallModel = nextState.firewallModel;
	if (hasOwn(nextState, "currentLayout")) currentLayout = nextState.currentLayout;
	if (hasOwn(nextState, "selectedTestPath")) selectedTestPath = nextState.selectedTestPath;
	if (hasOwn(nextState, "selectedPathCriteria")) selectedPathCriteria = nextState.selectedPathCriteria;
	if (hasOwn(nextState, "hostImportHasRun")) hostImportHasRun = nextState.hostImportHasRun;
	if (hasOwn(nextState, "subnetImportHasRun")) subnetImportHasRun = nextState.subnetImportHasRun;
	if (hasOwn(nextState, "sessionImportHasRun")) sessionImportHasRun = nextState.sessionImportHasRun;
	if (hasOwn(nextState, "importSectionCollapsed")) importSectionCollapsed = nextState.importSectionCollapsed;
	if (hasOwn(nextState, "storageAvailable")) storageAvailable = nextState.storageAvailable;
}
function __getState() {
	return {
		currentLayout,
		devices,
		firewallModel,
		hostImportHasRun,
		importSectionCollapsed,
		selectedPathCriteria,
		selectedTestPath,
		sessionImportHasRun,
		storageAvailable,
		subnetImportHasRun,
		subnetMappingsText
	};
}
Object.assign(globalThis.__appExports, {
	${EXPOSED_NAMES.join(",\n\t")},
	__getState,
	__setState
});
`;

	vm.createContext(sandbox);
	vm.runInContext(`${source}\n${setters}`, sandbox, { filename: APP_PATH });

	return {
		app: sandbox.__appExports,
		createElement,
		elements,
		localStorage,
		sandbox,
		setElement(id, element = createElement(id)) {
			elements.set(id, element);
			return element;
		}
	};
}

module.exports = {
	createElement,
	loadApp
};
