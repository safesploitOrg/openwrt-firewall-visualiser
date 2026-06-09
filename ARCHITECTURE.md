# Architecture: OpenWRT Firewall Relationship Visualiser

## Project Overview

**OpenWRT Firewall Relationship Visualiser** is an interactive web application that helps users understand complex firewall configurations by:
- Parsing OpenWRT firewall configuration files (`/etc/config/firewall`)
- Mapping real devices to firewall zones
- Visualizing network relationships using graph diagrams
- Testing device-to-device connectivity based on firewall rules
- Displaying zone connectivity matrices and device relationship maps

The application runs entirely client-side with no server component—all parsing and analysis happens in the browser.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Rendering** | HTML5 + CSS3 (custom dark theme) |
| **Interactivity** | Vanilla JavaScript (ES6+) |
| **Graph Visualization** | Cytoscape.js (CDN-loaded) |
| **Distribution** | Single HTML file (no build system) |

## File Structure

```
openwrt-firewall-visualiser/
├── README.md                  # Project documentation (currently empty)
├── ARCHITECTURE.md            # This file
└── public/
    └── index.html            # Complete single-file application
```

## Application Architecture

### Single-Page Application (SPA) Design

The entire application is contained in `public/index.html` with:
- **Markup**: Page layout using semantic HTML
- **Styling**: Scoped CSS variables with dark theme (blue/slate palette)
- **Logic**: Vanilla JavaScript with modular function organization

### Data Model

```typescript
// Firewall Configuration Model
interface FirewallModel {
  zones: {
    [zoneName: string]: {
      name: string;
      input: "ACCEPT" | "REJECT" | ...;   // Inbound traffic policy
      output: "ACCEPT" | "REJECT" | ...;  // Outbound traffic policy
      forward: "ACCEPT" | "REJECT" | ...; // Transit traffic policy
      networks: string[];                  // Associated network interfaces
    }
  };
  forwardings: {
    src: string;  // Source zone
    dest: string; // Destination zone
  }[];
  rules: {
    name: string;
    src: string;       // Source zone (optional)
    dest: string;      // Destination zone (optional)
    srcIp: string;     // Source IP address (optional)
    destIp: string;    // Destination IP address (optional)
    proto: string;     // Protocol (tcp, udp, etc.)
    destPort: string;  // Destination port
    target: "ACCEPT" | "REJECT" | ...; // Action
  }[];
}

// Device Mapping
interface Device {
  name: string;      // Display name (e.g., "Alexa Kitchen")
  ip: string;        // IP address (e.g., "172.16.20.10")
  zone: string;      // Assigned zone (e.g., "iot")
}
```

## Core Components & Functions

### 1. Input & Parsing Layer

**Functions**: `parseOpenWrtFirewall()`, `loadConfigFile()`, `loadExample()`

Parses OpenWRT UCL-style configuration text into the `FirewallModel`:
- Extracts `config zone` sections (zones define network security policies)
- Extracts `config forwarding` sections (zone-to-zone traffic permissions)
- Extracts `config rule` sections (specific IP/port-based rules)
- Handles comments and multiline values

**Key Parsing Logic**:
1. Split input by newlines
2. Match config section headers: `config <type> '<name>'`
3. Collect nested options: `option <key> '<value>'`
4. Collect list items: `list <key> '<value>'`
5. Build typed objects with consistent structure

### 2. Decision Logic Layer

**Functions**: `evaluateZonePath()`, `evaluateDevicePath()`, `findMatchingSpecificRule()`

Determines if traffic between zones/devices is allowed:

#### Zone-to-Zone Decision (`evaluateZonePath`)
```
If same zone:
  → Use zone.forward policy

If different zones:
  → Check if forwarding rule exists (src→dest)
  → If yes → ALLOW
  → If no → DENY
```

#### Device-to-Device Decision (`evaluateDevicePath`)
```
1. Find specific rule matching (src IP, dst IP, zones)
   → If found → Use rule.target
2. Fallback to zone-to-zone decision
   → Use evaluateZonePath(srcDevice.zone, dstDevice.zone)
```

Returns a decision object with:
```typescript
{
  allowed: boolean;
  reason: string;  // Human-readable explanation
}
```

### 3. Visualization Layer

#### A. Summary View (`renderSummary`)
Displays metrics in a card grid:
- Number of firewall zones
- Zone forwarding rules count
- Traffic rules count
- Mapped devices count

#### B. Zone View (`renderZoneView`)
Grid of zone cards showing:
- Zone name and associated networks
- Zone policies (input/output/forward)
- Devices mapped to each zone
- Visual indicator for IoT zones (highlight with warning style)

#### C. Connectivity Matrix (`renderMatrix`)
Table showing zone-to-zone connectivity:
- Rows/columns represent zones
- Cell content: "ALLOW" or "DENY"
- Color-coded (green/red)
- Evaluated using `evaluateZonePath()`

#### D. Device Relationship Map (`renderRelationshipMap`)
Grid of relationship cards showing all device pairs:
- Source device (name, zone, IP)
- Destination device (name, zone, IP)
- Decision (ALLOWED/BLOCKED)
- Reason (rule matched or zone decision)
- Visual indicator (border color: green/red)

#### E. Device Path Testing (`testDevicePath`)
Interactive tool to test specific device-to-device connectivity:
- Dropdown selectors for source/destination devices
- Evaluation using `evaluateDevicePath()`
- Highlights matching path in graph

#### F. Graph Visualization (`renderGraph`)

Uses **Cytoscape.js** (v3.30.4) to visualize network relationships.

**Graph Elements**:
- **Nodes**: Zones (blue rectangles) and Devices (purple ellipses)
- **Edges**: Relationships between nodes (colored by decision)

**Edge Types**:
- Green solid line: ALLOW (device/zone to zone)
- Red dashed line: DENY (blocked paths)
- Gray dotted line: Membership (device belongs to zone)

**Graph Styling**:
```javascript
- Zone nodes: 95×55px, blue, rounded rectangle
- Device nodes: 72×72px, purple, ellipse
- Edges: Bezier curves with triangle arrowheads
- Labels: Zone name, device name + IP
```

**Layout Options**:
1. **COSE** (Compound Spring Embedder): Physics-based layout
   - Good for discovering relationship clusters
   - Parameters: `nodeRepulsion: 9000`, `idealEdgeLength: 120`

2. **Circle**: Radial layout from center

3. **Breadthfirst**: Layered hierarchical layout
   - Good for directed acyclic graphs

**Interactivity**:
- Tap node → Highlight connected relationships (fade other elements)
- Tap empty space → Clear highlights
- Wheel scroll → Zoom

### 4. Device Management Layer

**Functions**: `addDevice()`, `removeDevice()`, `updateDevice()`, `resetDevices()`, `renderDeviceInputs()`

Manages the device-to-zone mapping list:
- Stores devices in `devices[]` array
- Default devices provided for example
- CRUD operations with real-time re-evaluation
- Persistent during session

### 5. Utility & Helper Functions

| Function | Purpose |
|----------|---------|
| `escapeHtml()` | HTML escape user input (XSS prevention) |
| `safeId()` | Normalize strings to valid DOM IDs |
| `normaliseTarget()` | Standardize policy values to uppercase |
| `zoneNodeId()`, `deviceNodeId()` | Generate consistent graph node IDs |
| `filterEdge()` | Filter graph edges by type/decision |
| `getGraphLayout()` | Configure Cytoscape layout parameters |

## Data Flow

```
┌─────────────────────┐
│ User Input          │
│ • Firewall config   │
│ • Device mapping    │
│ • Query parameters  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Parse & Process     │
│ parseOpenWrtFirewall│
│ buildDeviceRelation-│
│ships()             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Decision Engine     │
│ evaluateZonePath()  │
│ evaluateDevicePath()│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Render Views        │
│ • Summary           │
│ • Matrix            │
│ • Graph             │
│ • Relationships     │
└─────────────────────┘
```

## Key Features

### 1. **Firewall Config Parsing**
- Supports standard OpenWRT UCL format
- Extracts zones, forwardings, and rules
- Handles optional fields gracefully

### 2. **Device-to-Zone Mapping**
- Map real devices (by IP) to firewall zones
- Identify which devices can/cannot communicate
- Useful for IoT security analysis

### 3. **Multi-View Visualization**
- Summary metrics
- Zone cards with device listings
- Connectivity matrix (zone-to-zone)
- Relationship cards (all device pairs)
- Interactive graph diagram

### 4. **Rule Evaluation**
- Specific IP rules override zone policies
- Zone forwardings control inter-zone traffic
- Zone policies control intra-zone traffic
- Clear reasoning for every decision

### 5. **Interactive Graph**
- Multiple layout algorithms
- Filtering (all/allowed/blocked/zones-only/devices-only)
- Node highlighting
- Zoom/pan controls

### 6. **Path Testing**
- Test connectivity between specific devices
- View matching rules/reasons
- Highlight path in graph

## Example Firewall Model

The application includes a built-in example:

```
Zones:      lan, iot, guest, wan
Policies:   
  - lan:   ACCEPT input/output, ACCEPT forward (open)
  - iot:   REJECT input, ACCEPT output, REJECT forward (isolated)
  - guest: REJECT input/forward, ACCEPT output (guest network)
  - wan:   REJECT input/forward, ACCEPT output (external)

Forwardings:
  - lan → wan
  - iot → wan
  - guest → wan

Rules:
  - Allow specific Alexa devices to communicate within iot zone
  - Block generic east-west traffic in iot zone
```

## Security Considerations

1. **Client-Side Only**: No data sent to server—firewall config stays local
2. **HTML Escaping**: All user inputs escaped before rendering to prevent XSS
3. **No External Dependencies**: Only Cytoscape.js from CDN (graph visualization)
4. **Static File**: Can be served over HTTPS with no authentication needed

## Limitations & Design Tradeoffs

| Limitation | Reason |
|-----------|--------|
| Single file | Simpler deployment, no build system |
| Vanilla JS | No dependencies, easier to audit |
| In-memory parsing | Suitable for typical firewall configs (~100 KB) |
| No export/save | Focus on exploration; users can screenshot |
| Limited rule matching | Only basic IP/zone/port matching (real UFW is more complex) |

## Planned Features & Roadmap

### Immediate Priorities

#### 1. **Local Browser Storage (localStorage)**
- **Purpose**: Persist user state across sessions
- **What to Store**:
  - Firewall config text (device mapping is already derivable from firewall + devices)
  - Device list (name, IP, zone mappings)
  - User preferences (graph layout choice, filter preferences)
  - Last-used firewall config
- **Implementation**: 
  - Add `saveToLocalStorage()` function
  - Add `loadFromLocalStorage()` function
  - Auto-save on every parse/device change
  - Restore on page load

#### 2. **Auto-Detection Mode**
Remove the need for explicit button clicks by implementing reactive evaluation:

**A. Auto-Parse Firewall Config**
- Monitor textarea for changes (on `input` event)
- Debounce parsing (500ms) to avoid excessive calculations
- Replace explicit "Parse Firewall" button with optional "Parse Now" (for large configs)
- Auto-save to localStorage

**B. Auto-Test Device Path**
- Auto-evaluate when device selectors change
- Remove need for explicit "Test Path" button
- Immediately update results and graph highlighting

**C. Global Change Detection**
- Single `onchange` handler that re-renders all views
- Batch rendering updates for performance
- Track dirty state to avoid unnecessary re-renders

**Implementation Pattern**:
```javascript
// Debounced auto-parse
const autoParse = debounce(() => {
    parseAndRender();
    saveToLocalStorage();
}, 500);

// Attach to textarea
textarea.addEventListener('input', autoParse);
textarea.addEventListener('change', autoParse);

// Function: debounce(func, delay)
// Returns function that waits `delay`ms after last call before executing
```

#### 3. **Footer with Repository Info & Year**
Add a persistent footer showing:
- Link to GitHub repository
- Current year (auto-updated via provided function)
- Optional: Version/build date

**HTML Structure**:
```html
<footer>
    <a href="https://github.com/[owner]/openwrt-firewall-visualiser" target="_blank">
        GitHub Repository
    </a>
    <span> | © <span id="currentYear">2025</span></span>
</footer>
```

**CSS Styling**:
```css
footer {
    background: var(--bg-dark);
    border-top: 1px solid var(--border);
    padding: 1rem 1.5rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.9rem;
    margin-top: 2rem;
}

footer a {
    color: var(--info);
    text-decoration: none;
}

footer a:hover {
    text-decoration: underline;
}
```

**JavaScript**:
```javascript
const CURRENT_YEAR_ID = "currentYear";

function setCurrentYear() {
    const yearElement = document.getElementById(CURRENT_YEAR_ID);
    
    if (!yearElement) {
        return;
    }
    
    yearElement.textContent = String(new Date().getFullYear());
}

// Call on page load
document.addEventListener('DOMContentLoaded', setCurrentYear);
// Or in main()
function main() {
    document.getElementById("firewallInput").value = EXAMPLE_FIREWALL;
    setCurrentYear();  // Add this
    renderDeviceInputs();
    parseAndRender();
}
```

**Implementation Checklist**:
- [ ] Add footer HTML before closing `</body>`
- [ ] Add footer CSS to `<style>` block
- [ ] Add `setCurrentYear()` function
- [ ] Call `setCurrentYear()` in `main()`
- [ ] Update GitHub URL in href

---

### Future Enhancement Points

1. **Advanced Rule Matching**
   - Protocol-specific decisions
   - Port range validation
   - Stateful rule combinations

2. **Performance**
   - Rule indexing for large configs
   - Lazy graph rendering
   - Optimize device relationship computation for 100+ devices

3. **Additional Visualizations**
   - Traffic heat maps
   - Rule conflict detection
   - Policy recommendations
   - Timeline view of rule evaluations

4. **Import/Export**
   - Export visualizations as images/SVG
   - Export device mappings as JSON/CSV
   - Save/load session snapshots

5. **Multi-Config Comparison**
   - Diff two firewall configurations
   - Before/after change visualization
   - Change impact analysis

6. **Advanced Device Features**
   - Device groups (query multiple devices at once)
   - Protocol/port filtering
   - Geo-location awareness
   - Device asset tagging

## Development Notes

### No Build System
The application is intentionally a single HTML file with:
- Inline CSS (no separate stylesheet)
- Inline JavaScript (no modules)
- No npm/package manager required
- Deployable to any static host

### Extending the Code
Functions are organized by concern:
1. **Parsing**: `parseOpenWrtFirewall` and related
2. **Decision**: `evaluate*Path` functions
3. **Rendering**: `render*` functions
4. **Graph**: `buildGraphElements`, `renderGraph`
5. **Utilities**: Helper functions at end

To add features:
1. Extend `FirewallModel` interface
2. Add parsing logic in `parseOpenWrtFirewall`
3. Add decision logic in evaluation functions
4. Add rendering with new `render*` functions
5. Update graph elements in `buildGraphElements`

### Testing the Application
1. Paste OpenWRT firewall config in textarea
2. Click "Parse Firewall"
3. Add/edit devices in device mapping section
4. Observe visualization updates in real-time
5. Use graph filtering and testing tools

---

*Last Updated: 2025 | Single-file SPA for OpenWRT firewall visualization*
