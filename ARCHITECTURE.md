# Architecture: OpenWrt Firewall Relationship Visualiser

## Project Overview

The OpenWrt Firewall Relationship Visualiser is a single-page browser application for exploring `/etc/config/firewall` relationships. It helps a user paste or upload an OpenWrt firewall configuration, map real devices to firewall zones, and inspect likely zone-to-zone and device-to-device reachability.

The application is intentionally local-first:

- Firewall text is parsed in the browser.
- Firewall text, device mappings, graph preferences, and the selected test path are saved in `localStorage` when available.
- No backend, database, build step, or package manager is required.
- The only runtime dependency is Cytoscape.js, loaded from a CDN for graph rendering.

This is a visual analysis tool, not a full OpenWrt firewall simulator. The decision engine models the parts of the firewall that are useful for quick relationship checks, but it does not reproduce every fw3/fw4, nftables, iptables, NAT, conntrack, or bridge-level behaviour.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Markup | HTML5 |
| Styling | Inline CSS with custom properties and a dark theme |
| Behaviour | Vanilla JavaScript |
| Graph rendering | Cytoscape.js v3.30.4 from CDN |
| Distribution | Static `public/index.html` |

## File Structure

```text
openwrt-firewall-visualiser/
├── README.md          # Placeholder project documentation
├── ARCHITECTURE.md    # This architecture guide
└── public/
    └── index.html     # Complete single-file application
```

## Runtime State

The app keeps a small amount of global state inside `public/index.html`:

| Variable | Purpose |
| --- | --- |
| `devices` | User-editable list of named devices with IP address and zone |
| `firewallModel` | Parsed zones, forwardings, and traffic rules |
| `cy` | Current Cytoscape graph instance |
| `currentLayout` | Selected graph layout name |
| `selectedTestPath` | Source and destination device indexes used by the path tester |
| `storageAvailable` | Guard for browsers where `localStorage` is blocked or unavailable |

## Data Model

The runtime model is plain JavaScript rather than TypeScript, but it follows this shape:

```typescript
interface FirewallModel {
	zones: {
		[zoneName: string]: {
			name: string;
			input: string;
			output: string;
			forward: string;
			networks: string[];
		};
	};
	forwardings: {
		src: string;
		dest: string;
	}[];
	rules: {
		name: string;
		src: string;
		dest: string;
		srcIp: string;
		destIp: string;
		proto: string;
		destPort: string;
		target: string;
	}[];
}

interface Device {
	name: string;
	ip: string;
	zone: string;
}

interface Decision {
	allowed: boolean;
	reason: string;
}
```

## Phase A: Configuration And Device Input

Phase A gathers the two inputs needed for analysis:

- OpenWrt firewall configuration text, usually from `/etc/config/firewall`.
- Manual device mappings that assign a device name and IP address to a firewall zone.

Relevant functions:

| Function | Role |
| --- | --- |
| `main()` | Loads the example config and renders the initial view |
| `loadExample()` | Restores the built-in example config and default devices |
| `loadConfigFile(event)` | Uses `FileReader` to load a local config file into the textarea |
| `addDevice()` | Adds a blank editable device row |
| `updateDevice(index, key, value)` | Updates one device field and re-renders |
| `removeDevice(index)` | Deletes one device mapping |
| `resetDevices()` | Restores the default device list |
| `renderDeviceInputs()` | Renders editable device rows |

Device mappings are not inferred from the firewall config. OpenWrt firewall zones refer to logical networks, not individual client devices, so the user has to supply device-to-zone context manually.

## Phase B: OpenWrt UCI Parsing

Phase B turns OpenWrt UCI-style firewall text into a simple JavaScript model.

Relevant function:

| Function | Role |
| --- | --- |
| `parseOpenWrtFirewall(text)` | Parses `config`, `option`, and `list` lines into zones, forwardings, and rules |

Supported input patterns:

```text
config zone
    option name 'lan'
    option input 'ACCEPT'
    option output 'ACCEPT'
    option forward 'ACCEPT'
    list network 'lan'

config forwarding
    option src 'lan'
    option dest 'wan'

config rule
    option name 'Allow-example'
    option src 'iot'
    option dest 'iot'
    option src_ip '172.16.20.10'
    option dest_ip '172.16.20.11'
    option target 'ACCEPT'
```

Parser behaviour:

- Blank lines and whole-line comments are ignored.
- `config <type> '<name>'` starts a new section.
- `option <key> '<value>'` becomes a scalar property.
- `list <key> '<value>'` becomes an array property.
- Zone policy defaults are `REJECT` when not present.

Known parser limits:

- Inline comments are not stripped.
- Include files and generated firewall fragments are not followed.
- Complex quoting and escaped characters are not fully interpreted.
- Only `zone`, `forwarding`, and `rule` sections are represented in the model.

## Phase C: Connectivity Evaluation

Phase C answers the core question: "would this source be allowed to reach this destination?"

Relevant functions:

| Function | Role |
| --- | --- |
| `evaluateZonePath(srcZone, dstZone)` | Evaluates zone-to-zone reachability |
| `evaluateDevicePath(srcDevice, dstDevice)` | Evaluates device-to-device reachability |
| `findMatchingSpecificRule(srcDevice, dstDevice)` | Finds the first matching rule by zone and IP fields |
| `normaliseTarget(value)` | Compares rule and policy targets case-insensitively |

### Zone Decisions

For same-zone traffic:

```text
if srcZone == dstZone:
    use that zone's forward policy
```

For cross-zone traffic:

```text
if forwarding exists from srcZone to dstZone:
    ALLOW
else:
    DENY
```

This deliberately simplifies OpenWrt behaviour. The app does not currently evaluate zone `input` or `output` policies for cross-zone decisions, and it treats a forwarding section as sufficient to mark a path as allowed.

### Device Decisions

Device checks run in two steps:

```text
1. Find the first rule where src/dest zone and src/dest IP match.
   If found, ACCEPT means allowed; every other target is treated as blocked.

2. If no specific rule matches, fall back to evaluateZonePath().
```

The parser stores `proto` and `dest_port`, but the current decision engine does not use protocol or port matching. That should be addressed before presenting the app as an accurate per-service firewall analyser.

## Phase D: View Rendering

Phase D renders the parsed model and evaluation results into the page.

Relevant functions:

| Function | View |
| --- | --- |
| `renderSummary()` | Count cards for zones, forwardings, rules, and mapped devices |
| `renderZoneView()` | Zone cards with policies, networks, and mapped devices |
| `renderMatrix()` | Zone connectivity table using `evaluateZonePath()` |
| `renderDeviceSelectors()` | Source and destination dropdowns for path testing |
| `testDevicePath()` | Interactive single path test using `evaluateDevicePath()` |
| `renderRelationshipMap()` | All directed device-to-device relationship cards |

Rendering uses `escapeHtml()` before injecting user-controlled values into HTML strings. That is important because firewall files and device names are user input.

## Phase E: Graph Construction And Interaction

Phase E converts zones, devices, and decisions into Cytoscape elements.

Relevant functions:

| Function | Role |
| --- | --- |
| `renderGraph(layoutName = null)` | Creates or replaces the Cytoscape instance |
| `buildGraphElements()` | Builds all visible nodes and edges based on the current filter |
| `buildZoneRelationshipEdges()` | Builds directed zone decision edges |
| `buildDeviceRelationshipEdges()` | Builds directed device decision edges |
| `buildDeviceRelationships()` | Builds all directed device pairs except self-pairs |
| `filterEdge(edge, filter)` | Applies the selected graph filter |
| `getGraphLayout(layoutName)` | Returns Cytoscape layout settings |
| `fitGraph()` | Fits the current graph into the viewport |
| `highlightNodeRelationships(node)` | Highlights a tapped node and its connected elements |
| `highlightTestedPath(srcIndex, dstIndex)` | Highlights the tested source-to-destination path |

Graph node types:

| Type | Shape | Meaning |
| --- | --- | --- |
| Zone | Rounded rectangle | Firewall zone from the parsed config |
| Device | Ellipse | User-supplied device mapping |

Graph edge types:

| Type | Style | Meaning |
| --- | --- | --- |
| Membership | Grey dotted edge | Device belongs to a zone |
| Allowed relationship | Green solid edge | Evaluated path is allowed |
| Blocked relationship | Red dashed edge | Evaluated path is blocked |

Available layouts:

| Layout | Use |
| --- | --- |
| `cose` | Force-directed layout for exploring clusters |
| `circle` | Radial layout for compact overviews |
| `breadthfirst` | Layered directed layout |

Available filters:

- Show all relationships.
- Allowed only.
- Blocked only.
- Zone relationships only.
- Device relationships only.

## Phase F: Utilities And Defensive Helpers

Phase F provides small helpers shared by the earlier phases.

| Function | Purpose |
| --- | --- |
| `escapeHtml(value)` | Escapes user-controlled values before HTML insertion |
| `safeId(value)` | Produces stable IDs for graph nodes |
| `zoneNodeId(zoneName)` | Builds a graph ID for a zone |
| `deviceNodeId(index)` | Builds a graph ID for a device |

## Data Flow

```text
Phase A: User input
    firewall text
    device mappings

        |
        v

Phase B: Parse config
    parseOpenWrtFirewall()
    firewallModel

        |
        v

Phase C: Evaluate paths
    evaluateZonePath()
    evaluateDevicePath()

        |
        v

Phase D: Render standard views
    summary
    zone cards
    matrix
    relationship cards

        |
        v

Phase E: Render graph
    Cytoscape graph
```

## Example Model

The built-in example defines:

| Category | Contents |
| --- | --- |
| Zones | `lan`, `iot`, `guest`, `wan` |
| Forwardings | `lan -> wan`, `iot -> wan`, `guest -> wan` |
| Specific rules | Allow one Alexa-to-Alexa path, then reject broader IoT east-west traffic |
| Default devices | Admin laptop, two Alexa devices, IoT camera, guest phone |

The example is useful for demonstrating the relationship views, but it should not be treated as a recommended firewall policy.

## Security Considerations

- Firewall text and device mappings stay in the browser.
- Saved sessions use browser `localStorage`; they are not sent to a server.
- Local file loading uses the browser `FileReader` API.
- User-controlled strings are escaped before being inserted into rendered HTML.
- The app is static and can be hosted on any static web server.
- Cytoscape is loaded from a third-party CDN, so offline use or stricter supply-chain control would require vendoring that script locally.

## Limitations And Tradeoffs

| Limitation | Impact |
| --- | --- |
| Single HTML file | Easy to deploy, but harder to test and maintain as the app grows |
| Manual device mapping | Accurate device context depends on user input |
| Simplified parser | Good for common UCI files, not a complete UCI interpreter |
| Simplified decision engine | Useful for visual exploration, not a full firewall simulation |
| Protocol and port fields are not evaluated | Per-service conclusions may be inaccurate |
| Browser-local persistence | Saved state is per browser/profile unless exported as JSON |
| CDN dependency | Graph rendering depends on external script availability |
| No automated tests | Behaviour is currently verified manually |

## Roadmap

### Phase A: Persistence

Status: implemented.

The app saves session state to `localStorage` after parsing, device changes, graph layout/filter changes, and path-test selection changes.

Stored fields:

- Firewall config text.
- Device list.
- Selected graph layout.
- Selected graph filter.
- Last tested source and destination device indexes.

Relevant functions:

- `saveState()`.
- `loadState()`.
- `clearExpiredState()`.
- `readStoredState()`.
- `normaliseSavedDevices()`.
- `normaliseSavedTestPath()`.

### Phase B: Reactive Updates

Status: implemented.

The app now responds to input changes while keeping the explicit buttons as manual controls.

Implemented behaviour:

- The firewall textarea has a debounced `input` handler.
- The "Parse Firewall" button remains available.
- The selected device path re-tests when either selector changes.
- Parse/render changes are persisted automatically when `localStorage` is available.

Relevant functions:

- `debounce()`.
- `autoParse`.
- `bindReactiveControls()`.
- `handleTestSelectorChange()`.
- `renderCurrentTestResult()`.

### Phase C: Project Metadata

Status: implemented.

The page footer shows:

- GitHub repository link.
- Current year from `new Date().getFullYear()`.

Relevant functions and elements:

- `.site-footer`.
- `#currentYear`.
- `setCurrentYear()`.

## Implemented Future Enhancements

The following phases continue the roadmap sequence after Phase A-C and are now implemented in `public/index.html`.

### Phase D: Local Storage Lifecycle Management

Status: implemented.

Objective: prevent stale browser state from living indefinitely while keeping the local-first workflow.

Requirements:

- Store a timestamp alongside all persisted `localStorage` data.
- Automatically expire stored data after 45 days.
- Remove expired data silently on application startup.
- Fall back to the default example configuration when stored data has expired.
- Handle corrupted `localStorage` data gracefully.
- Preserve backwards compatibility where possible for existing saved payloads.

Implemented details:

- `STORAGE_KEY` remains the stable state namespace.
- `STORAGE_TTL_DAYS = 45` defines expiry.
- `savedAt` is stored in the persisted payload.
- `saveState()` writes the timestamped state.
- `loadState()` restores state and falls back to defaults.
- `clearExpiredState()` silently removes expired or corrupted payloads on startup.

### Phase E: Graph Initial State Improvements

Status: implemented.

Objective: improve first-load user experience by preventing automatic path highlighting.

Requirements:

- No device relationship should be highlighted on initial page load.
- No graph nodes should be automatically selected on initial page load.
- No path should be highlighted until the user explicitly clicks "Test Path".
- No path should be highlighted until the user explicitly clicks a graph node.
- No path should be highlighted until the user explicitly clicks a relationship entry.

Implemented details:

- Path-result rendering is separated from graph path highlighting.
- `graphPathHighlightRequested` tracks explicit path-highlighting intent.
- Automatic re-renders update text results without selecting graph elements.
- Graph highlighting is triggered only by "Test Path", graph node clicks, or relationship-card clicks.

### Phase F: Bulk Host Import

Status: implemented.

Objective: allow users to populate devices from existing network inventories instead of manually adding hosts one at a time.

Requirements:

- Add a dedicated "Bulk Import Hosts" section.
- Support device inventory exports.
- Support host lists.
- Support DHCP exports.
- Support ARP tables.
- Support neighbour tables.
- Merge imported hosts into the existing device list without destroying manually entered devices.

Supported preferred format:

```text
172.16.20.10 Alexa-Kitchen iot
172.16.20.11 Alexa-Bedroom iot
172.16.20.50 IoT-Camera iot
172.16.30.25 Guest-Phone guest
```

Supported simplified format:

```text
Alexa-Kitchen 172.16.20.10 iot
IoT-Camera 172.16.20.50 iot
```

Supported Linux neighbour table format:

```text
172.16.20.10 dev br-iot lladdr aa:bb:cc:dd:ee:ff REACHABLE
172.16.20.11 dev br-iot lladdr aa:bb:cc:dd:ee:00 STALE
```

Implemented details:

- `importBulkHosts()` imports the textarea content.
- `parseBulkHosts()` parses host data line-by-line.
- `parseHostLine()` handles host-list, neighbour/ARP, and DHCP lease formats.
- `mergeDevices()` merges by IP without overwriting manually supplied names or zones.
- Skipped and unresolved lines are reported in the import result panel.

Benefits:

- Significantly reduces data entry effort.
- Improves usability on larger networks.
- Makes importing existing homelab inventories straightforward.

### Phase G: Zone Inference Engine

Status: partially implemented.

Objective: automatically assign firewall zones from subnet definitions when imported hosts do not include a zone.

Requirements:

- Allow users to define subnet-to-zone mappings.
- Infer the zone for imported hosts by matching host IPs against the configured CIDR ranges.
- Preserve explicitly supplied host zones over inferred zones.
- Mark hosts as unresolved when no subnet mapping matches.

Example subnet mappings:

```text
172.16.10.0/24 lan
172.16.20.0/24 iot
172.16.30.0/24 guest
172.16.40.0/24 servers
```

Example imported host:

```text
172.16.20.50 IoT-Camera
```

Expected inferred result:

```text
zone = iot
```

Implemented details:

- The `subnetMappings` textarea stores subnet-to-zone mappings.
- `parseSubnetMappings()` parses CIDR mappings.
- `inferZoneForIp()` assigns zones during import when a host line has no explicit zone.
- Unresolved imported hosts are counted in the import result panel.

Todo:

- Supported Input Formats
    - 1. Manual Zone/Subnet Mapping (done)
    - 2. OpenWRT UCI Export (todo)
        - uci show firewall | grep "\.network=" 
        - uci show network | grep -E "\.(ipaddr|netmask|proto)="
- 

### Phase H: Network Discovery Importers

Status: partially implemented.

Objective: support importing host data directly from common network tooling output.

Initial import targets:

- Linux `ip neighbour`.
- Linux `arp -a`.
- OpenWrt `ip neighbour`.
- OpenWrt `cat /tmp/dhcp.leases`, preferably because it includes hostnames.

Implemented details:

- `parseNeighbourLine()` supports Linux/OpenWrt `ip neighbour` and common `arp -a` output.
- `parseDhcpLeaseLine()` supports OpenWrt `/tmp/dhcp.leases`.
- DHCP hostnames are preferred when present.
- IP-only names are used when no hostname is available.
- Skipped source lines are shown in the import result panel.

TODO:

- Better placeholder for different import methods
- Support for `openwrt_export_hosts.sh` script
    - ip,hostname,zone,mac
        172.16.20.10,Alexa-Kitchen,iot,aa:bb:cc:dd:ee:ff
        172.16.20.11,Alexa-Bedroom,iot,aa:bb:cc:dd:ee:00
        172.16.30.25,Guest-Phone,guest,aa:bb:cc:dd:ee:11
    - ? button which points to the script
- 

### Phase I: Relationship Analysis Engine

Status: implemented.

Objective: move beyond visualisation and provide automated security analysis.

Requirements:

- Detect IoT east-west communication.
- Detect guest-to-LAN exposure.
- Detect guest-to-server exposure.
- Detect server-to-IoT exposure.
- Detect excessive zone trust.
- Detect full-mesh communication patterns.
- Detect zones with unrestricted forwarding.
- Detect device exceptions that bypass segmentation.

Implemented details:

- `buildAnalysisFindings()` builds findings on top of `evaluateZonePath()` and `evaluateDevicePath()`.
- Findings include severity, title, and reason.
- `renderAnalysisFindings()` renders the findings panel.

### Phase J: Rule Engine Accuracy

Status: implemented.

Decision accuracy has been improved before adding policy recommendations.

Implemented improvements:

- Honour protocol matching.
- Honour destination port matching.
- Represent rule order more explicitly in explanations.
- Distinguish `ACCEPT`, `REJECT`, and `DROP`.
- Surface unsupported rule fields in the UI.
- Keep zone `input` and `output` visible in zone cards while forwarding decisions remain based on zone forwardings and same-zone forward policy.

### Phase K: Import, Export, And Comparison

Status: Mostly.

Workflows for longer-lived analysis are now available.

Implemented improvements:

- Export device mappings as JSON or CSV.
- Import saved device mappings.
- Export graph images.
- Compare two firewall configs.
- Show before/after impact for changed forwardings and rules.

Todo:

- Clear colour coding for Export Session
- Clearer button for Import Session


## Development Notes

The current implementation is intentionally simple:

- Inline CSS.
- Inline JavaScript.
- No modules.
- No build tooling.
- No npm dependencies.

When adding a feature, follow the phase order:

1. Phase A: Decide whether new user input or state is needed.
2. Phase B: Extend parsing only if the firewall model needs new data.
3. Phase C: Update evaluation logic and explanations.
4. Phase D: Render the new result in the non-graph views.
5. Phase E: Add graph nodes, edges, labels, or filters if useful.
6. Phase F: Add or update helper functions only when shared behaviour emerges.

## Manual Verification

Use this workflow after changes:

1. Open `public/index.html` in a browser.
2. Confirm the built-in example renders automatically.
3. Click "Parse Firewall" and check the summary, matrix, zone cards, relationship cards, and graph.
4. Add, edit, and remove a device mapping.
5. Test a specific source-to-destination path.
6. Try each graph layout and filter.
7. Upload a local firewall config and verify that no data leaves the browser except the Cytoscape CDN request.

## Last Updated

2026-06-09
