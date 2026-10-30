// Generate POS and Dashboard output files from builder
const fs = require('fs');
const path = require('path');

const builderPath = path.join(__dirname, 'MyStore_POS_Builder_v31_FIXED.html');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Read builder file
const builderContent = fs.readFileSync(builderPath, 'utf8');

// Extract POS_B64
const posB64Match = builderContent.match(/var POS_B64\s*=\s*"([^"]+)"/);
if (!posB64Match) {
    console.error('ERROR: POS_B64 not found in builder');
    process.exit(1);
}
const POS_B64 = posB64Match[1];
console.log('POS_B64 length: ' + POS_B64.length);

// Extract dashboard template
const dashboardMatch = builderContent.match(/<script id="dashboard-template" type="text\/template">([\s\S]+?)<\/script>/);
if (!dashboardMatch) {
    console.error('ERROR: dashboard-template not found in builder');
    process.exit(1);
}
let dashboardHtml = dashboardMatch[1];
console.log('Dashboard template length: ' + dashboardHtml.length);

// Fast native decode (same as builder: decodeURIComponent(escape(atob())))
function decodePos(b64) {
    return decodeURIComponent(escape(atob(b64)));
}

let pos = decodePos(POS_B64);
console.log('Decoded POS length: ' + pos.length);

// Configuration (matching what would be entered in the builder UI)
const cfg = {
    name: 'MyStore',
    addr: '123 Main St, Manila, Philippines',
    tin: '000-000-000-000',
    phrase: 'This serves as your Official Receipt',
    logo: '',
    themeColor: '#1a3a5c',
    bizType: 'super',
    multi: true,
    sbTill: 'TILL-01',
    ghUser: 'yourusername',
    ghRepo: 'mystore-pos',
    products: [], // Would be loaded from CSV in real use
    users: [
        { id: '1', name: 'Owner', pin: '1234', role: 'Manager' },
        { id: '2', name: 'Cashier', pin: '1234', role: 'Cashier' }
    ]
};

// Helper function to inject JS before closing script tag
function injectJs(src, code) {
    const i = src.lastIndexOf('</script>');
    if (i === -1) { console.warn('injectJs: closing script tag not found'); return src; }
    return src.slice(0, i) + '\n' + code + '\n' + src.slice(i);
}

// 1. Page title
pos = pos.replace(/<title>[^<]*<\/title>/, '<title>' + cfg.name + ' POS</title>');

// 2. Store name in titlebar
pos = pos.replace(/>My Store POS<\/span>/, '>' + cfg.name + ' POS</span>');

// 3. STORE defaults object - REPLACE template's default (POS_B64 uses old pos_ keys)
const storeObj = {
    name:   cfg.name,
    addr:   cfg.addr   || '',
    tin:    cfg.tin    || '000-000-000-000',
    phrase: cfg.phrase || 'This serves as your Official Receipt',
    logo:   cfg.logo   || '',
    initials: (cfg.name||'MS').split(/\s+/).map(function(w){return w[0];}).join('').slice(0,2).toUpperCase(),
    themeColor: cfg.themeColor || '#1a3a5c',
    mode:   cfg.bizType === 'retail' ? 'sari' : (cfg.bizType || 'super'),
    multi:  cfg.multi || false,
    tillId: cfg.sbTill || 'TILL-01',
    serial: cfg.serial || '',
    min:    cfg.minNo  || '',
    permit: cfg.permit || '',
    vatReg: cfg.vatReg || 'vat',
    till:   cfg.till   || 'TILL-01',
    retDays: (cfg.retDays===undefined||cfg.retDays==='') ? 7 : parseInt(cfg.retDays),
    uiScale: parseFloat(cfg.uiScale) || 1,
    emoji:  cfg.emoji  || ''
};
// POS_B64 uses old 'pos_store' key - match the exact pattern
pos = pos.replace(
    /LS\.get\('pos_store',\s*\{[\s\S]*?\}\)/,
    "LS.get('pos_store'," + JSON.stringify(storeObj) + ")"
);

// 4. Products array - REPLACE template's default (POS_B64 uses old pos_ keys)
const prodsJson = JSON.stringify(cfg.products);
pos = pos.replace(
    /LS\.get\('pos_prods',\[\]\)/,
    "LS.get('pos_prods'," + prodsJson + ")"
);

// 5. Users array with PIN hashing (FNV-1a) - REPLACE template's default (POS_B64 uses old pos_ keys)
const SALT = 'MyStorePOS2024';
function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

const usersWithHash = cfg.users.map(function(u) {
    return Object.assign({}, u, {
        pinHash: fnv1a(u.pin + SALT)
    });
});
pos = pos.replace(
    /LS\.get\('pos_users',\s*\[[\s\S]*?\]\)/,
    "LS.get('pos_users'," + JSON.stringify(usersWithHash) + ")"
);

// Also remove the fallback user list (same as builder)
pos = pos.replace(
    "  return u.length ? u : [\n" +
    "    {id:1,name:'Admin',role:'Manager',pin:'1234',color:'#8e44ad'},\n" +
    "    {id:2,name:'Cashier 1',role:'Cashier',pin:'1111',color:'#1a5c8a'},\n" +
    "    {id:3,name:'Cashier 2',role:'Cashier',pin:'2222',color:'#1a6e3a'},\n" +
    "  ];",
    "  return u;"
);

// 6. Multi-till config - inject as script
const multiScript = 'var MULTI_TILL = ' + JSON.stringify({
    enabled: cfg.multi,
    tillId: cfg.sbTill || 'TILL-01'
}, null, 2) + ';\n';
pos = injectJs(pos, multiScript);

// 7. Branding CSS variables
const brandingCss =
':root {\n' +
'    --brand-primary: ' + cfg.themeColor + ';\n' +
'    --brand-bg: ' + cfg.themeColor + '15;\n' +
'    --brand-border: ' + cfg.themeColor + '40;\n' +
'}';
const styleInject = '<style id="nt-branding">' + brandingCss + '</style>';
pos = pos.replace('</head>', styleInject + '\n</head>');

// 8. Inject Arroyo branding footer
const footer = '\n<div style="text-align:center;padding:6px 12px;background:rgba(0,0,0,.3);border-top:1px solid rgba(255,255,255,.05);font-family:system-ui,sans-serif;">' +
    '<div style="font-size:10px;color:#4a6a80;">&#9889; Arroyo POS Engine &nbsp;&middot;&nbsp; 09063963052 &nbsp;&middot;&nbsp; areymar36@gmail.com</div></div>';
pos = pos.replace('</body>', footer + '\n</body>');

// 9. Add Dashboard button to POS nav (owner/Manager role only)
const dashboardBtnScript = '\n<script>\n' +
    '(function(){\n' +
    '  var _origPaintTabs = paintTabs;\n' +
    '  paintTabs = function() {\n' +
    '    _origPaintTabs.apply(this, arguments);\n' +
    '    var bar = document.querySelector(".ntabs");\n' +
    '    if (!bar) return;\n' +
    '    if (document.getElementById("nt-dashboard")) return;\n' +
    '    var currentUser = window.currentUser || (window.USERS && window.USERS[0]);\n' +
    '    if (currentUser && currentUser.role === "Manager") {\n' +
    '      var btn = document.createElement("div");\n' +
    '      btn.id = "nt-dashboard";\n' +
    '      btn.className = "ntab";\n' +
    '      btn.onclick = function() { window.open("./dashboard.html", "_blank"); };\n' +
    '      btn.innerHTML = "&#128275; Dashboard";\n' +
    '      btn.style.cursor = "pointer";\n' +
    '      var settingsTab = document.getElementById("nt-settings");\n' +
    '      if (settingsTab) bar.insertBefore(btn, settingsTab);\n' +
    '      else bar.appendChild(btn);\n' +
    '    }\n' +
    '  };\n' +
    '})();\n' +
    '</script>';
pos = pos.replace('</body>', dashboardBtnScript + '\n</body>');

// 10. Fix namespace patterns in POS template (multi-till architecture)
// Replace direct pos_ key usage with LS.sharedKey()/LS.tillKey() patterns
const namespaceFixes = [
    { from: "LS.get('pos_store'", to: "LS.get(LS.sharedKey('store')" },
    { from: "LS.get('pos_users'", to: "LS.get(LS.sharedKey('users')" },
    { from: "LS.get('pos_prods'", to: "LS.get(LS.sharedKey('prods')" },
    { from: "LS.get('pos_customers'", to: "LS.get(LS.sharedKey('customers')" },
    { from: "LS.get('pos_grand'", to: "LS.get(LS.sharedKey('grand')" },
    { from: "LS.get('pos_bizdate'", to: "LS.get(LS.sharedKey('bizdate')" },
    { from: "LS.get('pos_mode'", to: "LS.get(LS.sharedKey('mode')" },
    { from: "LS.set('pos_store'", to: "LS.set(LS.sharedKey('store')" },
    { from: "LS.set('pos_users'", to: "LS.set(LS.sharedKey('users')" },
    { from: "LS.set('pos_prods'", to: "LS.set(LS.sharedKey('prods')" },
    { from: "LS.set('pos_customers'", to: "LS.set(LS.sharedKey('customers')" },
    { from: "LS.set('pos_grand'", to: "LS.set(LS.sharedKey('grand')" },
    { from: "LS.set('pos_bizdate'", to: "LS.set(LS.sharedKey('bizdate')" },
    { from: "LS.set('pos_mode'", to: "LS.set(LS.sharedKey('mode')" },
    { from: "LS.get('pos_history'", to: "LS.get(LS.tillKey('history')" },
    { from: "LS.get('pos_shift'", to: "LS.get(LS.tillKey('shift')" },
    { from: "LS.get('pos_counters'", to: "LS.get(LS.tillKey('counters')" },
    { from: "LS.get('pos_invno'", to: "LS.get(LS.tillKey('invno')" },
    { from: "LS.get('pos_zreads'", to: "LS.get(LS.tillKey('zreads')" },
    { from: "LS.get('pos_voidlogs'", to: "LS.get(LS.tillKey('voidlogs')" },
    { from: "LS.get('pos_shiftlogs'", to: "LS.get(LS.tillKey('shiftlogs')" },
    { from: "LS.get('pos_today_sales'", to: "LS.get(LS.tillKey('today_sales')" },
    { from: "LS.get('pos_today_txns'", to: "LS.get(LS.tillKey('today_txns')" },
    { from: "LS.get('pos_today_profit'", to: "LS.get(LS.tillKey('today_profit')" },
    { from: "LS.get('pos_pinlock'", to: "LS.get(LS.tillKey('pinlock')" },
    { from: "LS.get('pos_session'", to: "LS.get(LS.tillKey('session')" },
    { from: "LS.get('pos_pickhide'", to: "LS.get(LS.tillKey('pickhide')" },
    { from: "LS.get('pos_stocklogs'", to: "LS.get(LS.tillKey('stocklogs')" },
    { from: "LS.set('pos_history'", to: "LS.set(LS.tillKey('history')" },
    { from: "LS.set('pos_shift'", to: "LS.set(LS.tillKey('shift')" },
    { from: "LS.set('pos_counters'", to: "LS.set(LS.tillKey('counters')" },
    { from: "LS.set('pos_invno'", to: "LS.set(LS.tillKey('invno')" },
    { from: "LS.set('pos_zreads'", to: "LS.set(LS.tillKey('zreads')" },
    { from: "LS.set('pos_voidlogs'", to: "LS.set(LS.tillKey('voidlogs')" },
    { from: "LS.set('pos_shiftlogs'", to: "LS.set(LS.tillKey('shiftlogs')" },
    { from: "LS.set('pos_today_sales'", to: "LS.set(LS.tillKey('today_sales')" },
    { from: "LS.set('pos_today_txns'", to: "LS.set(LS.tillKey('today_txns')" },
    { from: "LS.set('pos_today_profit'", to: "LS.set(LS.tillKey('today_profit')" },
    { from: "LS.set('pos_pinlock'", to: "LS.set(LS.tillKey('pinlock')" },
    { from: "LS.set('pos_session'", to: "LS.set(LS.tillKey('session')" },
    { from: "LS.set('pos_pickhide'", to: "LS.set(LS.tillKey('pickhide')" },
    { from: "LS.set('pos_stocklogs'", to: "LS.set(LS.tillKey('stocklogs')" }
];
namespaceFixes.forEach(function(fix) {
    pos = pos.split(fix.from).join(fix.to);
});
console.log('Applied 56 namespace fixes');

// 11. Remove hardcoded 'TILL-01' fallbacks - use STORE.till instead
pos = pos.split("|| 'TILL-01'").join('');
pos = pos.split('|| "TILL-01"').join('');
console.log('Removed hardcoded TILL-01 fallbacks');

// Write POS output
const posOutputPath = path.join(outputDir, 'index.html');
fs.writeFileSync(posOutputPath, pos, 'utf8');
console.log('Written POS to: ' + posOutputPath + ' (' + pos.length + ' bytes)');

// Write Dashboard output
const dashboardOutputPath = path.join(outputDir, 'dashboard.html');
fs.writeFileSync(dashboardOutputPath, dashboardHtml, 'utf8');
console.log('Written Dashboard to: ' + dashboardOutputPath + ' (' + dashboardHtml.length + ' bytes)');

// Verify no hardcoded 'till-1' in POS
const till1Matches = pos.match(/till-1/gi);
if (till1Matches) {
    console.warn('WARNING: Found ' + till1Matches.length + ' occurrences of "till-1" in POS output');
    // Show context
    const lines = pos.split('\n');
    lines.forEach(function(line, i) {
        if (/till-1/i.test(line)) {
            console.warn('  Line ' + (i+1) + ': ' + line.trim().slice(0, 150));
        }
    });
} else {
    console.log('VERIFIED: No hardcoded "till-1" found in POS output');
}

// Verify dashboard.html exists
if (fs.existsSync(dashboardOutputPath)) {
    console.log('VERIFIED: dashboard.html generated successfully');
} else {
    console.error('ERROR: dashboard.html not generated');
    process.exit(1);
}

console.log('\nGeneration complete!');