import { env } from '../config/env';
import { DataCipher } from './crypto';

export const cipher = new DataCipher(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_ACTIVE_KEY);

// Additional authenticated data binds each ciphertext to the row it belongs to, so a value
// copied into another row (or another person's template) fails to decrypt.
export const templateAad = (templateId: string, personId: string) => `face_template:${templateId}:${personId}`;
export const portraitAad = (templateId: string, personId: string) => `face_portrait:${templateId}:${personId}`;
export const credentialsAad = (cameraId: string) => `camera_credentials:${cameraId}`;
export const evidenceAad = (evidenceId: string) => `evidence:${evidenceId}`;
