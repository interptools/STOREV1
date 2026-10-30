const fs = require('fs');
const builderContent = fs.readFileSync('MyStore_POS_Builder_v31_FIXED.html', 'utf8');
const posB64Match = builderContent.match(/var POS_B64\s*=\s*"([^"]+)"/);
const POS_B64 = posB64Match[1];

function decodePos(b64) {
    return decodeURIComponent(escape(atob(b64)));
}
const pos = decodePos(POS_B64);

// Search for old pos_ patterns
console.log('=== SEARCHING FOR "pos_store" ===');
let regex = /pos_store/g;
let match;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}

console.log('\n=== SEARCHING FOR "pos_users" ===');
regex = /pos_users/g;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}

console.log('\n=== SEARCHING FOR "pos_prods" ===');
regex = /pos_prods/g;
while ((match = regex.exec(pos)) !== null) {
    console.log('  at index', match.index, ':', pos.substring(match.index, match.index + 150));
}