import { describe, expect, it } from 'vitest';
import { parseServiceAccountJson } from '../../src/lib/firebase/admin';

describe('parseServiceAccountJson', () => {
  const sampleJson = {
    project_id: 'uinexus-f379f',
    client_email: 'firebase-adminsdk-fbsvc@uinexus-f379f.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDm5KrO623FauGu\\n-----END PRIVATE KEY-----\\n',
  };

  it('parsea un JSON estándar en texto', () => {
    const raw = JSON.stringify(sampleJson);
    const parsed = parseServiceAccountJson(raw);
    expect(parsed.project_id).toBe('uinexus-f379f');
    expect(parsed.client_email).toBe('firebase-adminsdk-fbsvc@uinexus-f379f.iam.gserviceaccount.com');
  });

  it('parsea JSON codificado en base64', () => {
    const base64 = Buffer.from(JSON.stringify(sampleJson)).toString('base64');
    const parsed = parseServiceAccountJson(base64);
    expect(parsed.project_id).toBe('uinexus-f379f');
    expect(parsed.client_email).toBe('firebase-adminsdk-fbsvc@uinexus-f379f.iam.gserviceaccount.com');
  });

  it('desempaqueta comillas externas accidentales', () => {
    const raw = `"${JSON.stringify(sampleJson)}"`;
    const parsed = parseServiceAccountJson(raw);
    expect(parsed.project_id).toBe('uinexus-f379f');
  });

  it('lanza error descriptivo si faltan campos obligatorios', () => {
    expect(() => parseServiceAccountJson('{"project_id":"uinexus-f379f"}')).toThrow(
      /no contiene project_id, client_email o private_key/
    );
  });
});
