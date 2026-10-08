/* eslint-disable no-console */
import crypto from 'node:crypto';

const b64 = (n: number) => crypto.randomBytes(n).toString('base64');

console.log('# Paste into .env (generate separate values for each environment)');
console.log(`JWT_ACCESS_SECRET=${b64(64)}`);
console.log(`EVIDENCE_URL_SECRET=${b64(32)}`);
console.log(`DATA_ENCRYPTION_KEYS=k1:${b64(32)}`);
console.log('DATA_ENCRYPTION_ACTIVE_KEY=k1');
console.log(`INTERNAL_SERVICE_TOKEN=${crypto.randomBytes(32).toString('base64url')}`);
console.log('# Docker Compose only (hex so they are safe inside connection URLs)');
console.log(`DB_PASSWORD=${crypto.randomBytes(24).toString('hex')}`);
console.log(`MYSQL_ROOT_PASSWORD=${crypto.randomBytes(24).toString('hex')}`);
console.log(`REDIS_PASSWORD=${crypto.randomBytes(24).toString('hex')}`);
