export const ACTORS = {
  teacherA: { uid: 'uid-teacher-a', token: 'token-teacher-a' },
  teacherB: { uid: 'uid-teacher-b', token: 'token-teacher-b' },
  studentA: { uid: 'uid-student-a', token: 'token-student-a' },
  studentB: { uid: 'uid-student-b', token: 'token-student-b' },
  outsiderStudent: { uid: 'uid-student-outsider', token: 'token-student-outsider' },
} as const;

type TestActor = (typeof ACTORS)[keyof typeof ACTORS];

export function requestAs(actor: TestActor, url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${actor.token}`);
  return new Request(url, { ...init, headers });
}

export function jsonRequestAs(
  actor: TestActor,
  url: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body: unknown
): Request {
  return requestAs(actor, url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
