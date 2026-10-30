const fs = require('fs');
const builderContent = fs.readFileSync('MyStore_POS_Builder_v31_FIXED.html', 'utf8');
const posB64Match = builderContent.match(/var POS_B64\s*=\s*"([^"]+)"/);
const POS_B64 = posB64Match[1];

// Decode
function decodePos(b64) {
    return decodeURIComponent(escape(atob(b64)));
}
const pos = decodePos(POS_B64);

// Test store regex on decoded POS
const storeRegex = /let STORE = LS\.get\(LS\.sharedKey\('store'\),\s*\{[\s\S]*?\}\)/;
const match = pos.match(storeRegex);
if (match) {
    console.log('STORE MATCH FOUND in decoded POS (' + match[0].length + ' chars):');
    console.log(match[0].substring(0, 200));
} else {
    console.log('STORE NO MATCH in decoded POS');
}

// Test users regex
const usersRegex = /USERS = LS\.get\(LS\.sharedKey\('users'\),\s*\[[\s\S]*?\]\)/;
const match2 = pos.match(usersRegex);
if (match2) {
    console.log('\nUSERS MATCH FOUND in decoded POS (' + match2[0].length + ' chars):');
    console.log(match2[0]);
} else {
    console.log('\nUSERS NO MATCH in decoded POS');
}

// Test prods regex
const prodsRegex = /prods = LS\.get\(LS\.sharedKey\('prods'\),\s*\[[\s\S]*?\]\)/;
const match3 = pos.match(prodsRegex);
if (match3) {
    console.log('\nPRODS MATCH FOUND in decoded POS (' + match3[0].length + ' chars):');
    console.log(match3[0]);
} else {
    console.log('\nPRODS NO MATCH in decoded POS');
}