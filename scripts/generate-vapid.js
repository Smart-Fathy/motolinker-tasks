// Run once to generate VAPID keys for web push notifications:
//   npm install web-push
//   node scripts/generate-vapid.js
//
// Then add the two output lines as Railway environment variables.

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these to Railway environment variables:\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('');
