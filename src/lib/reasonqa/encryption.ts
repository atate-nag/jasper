// AES-256-GCM encryption for document text retention.
// Documents are encrypted at rest and auto-expire after 30 days.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.REASONQA_DOC_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('REASONQA_DOC_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptText(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, tag]), iv };
}

export function decryptText(ciphertext: Buffer, iv: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}
