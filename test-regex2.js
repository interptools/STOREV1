const fs = require('fs');
const builderContent = fs.readFileSync('MyStore_POS_Builder_v31_FIXED.html', 'utf8');
const posB64Match = builderContent.match(/var POS_B64\s*=\s*"([^"]+)"/);
const POS_B64 = posB64Match[1];

function decodePos(b64) {
    return decodeURIComponent(escape(atob(b64)));
}
const pos = decodePos(POS_B64);

// Search for store patterns
console.log('=== SEARCHING FOR "sharedKey(\'store\')" ===');
let regex = /sharedKey\('store'/g;
let match;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}

// Search for users patterns
console.log('\n=== SEARCHING FOR "sharedKey(\'users\')" ===');
regex = /sharedKey\('users'/g;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}

// Search for prods patterns
console.log('\n=== SEARCHING FOR "sharedKey(\'prods\')" ===');
regex = /sharedKey\('prods'/g;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}