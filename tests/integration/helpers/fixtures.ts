import type { CourseMemberRecord, CourseRecord, PublicUser, UserRole } from '@/lib/types';

const timestamp = '2026-09-01T00:00:00.000Z';

export const PEOPLE = {
  teacherA: {
    uid: 'uid-teacher-a',
    handle: 'teacher-a',
    displayName: 'Teacher A',
    avatarUrl: null,
  },
  teacherB: {
    uid: 'uid-teacher-b',
    handle: 'teacher-b',
    displayName: 'Teacher B',
    avatarUrl: null,
  },
  studentA: {
    uid: 'uid-student-a',
    handle: 'student-a',
    displayName: 'Student A',
    avatarUrl: null,
  },
  studentB: {
    uid: 'uid-student-b',
    handle: 'student-b',
    displayName: 'Student B',
    avatarUrl: null,
  },
  outsiderStudent: {
    uid: 'uid-student-outsider',
    handle: 'student-outsider',
    displayName: 'Student Outsider',
    avatarUrl: null,
  },
} satisfies Record<string, CourseMemberRecord>;

function profile(person: CourseMemberRecord, role: UserRole) {
  return {
    ...person,
    bio: null,
    program: null,
    role,
    projectCount: 0,
    createdAt: timestamp,
    suspended: false,
  } satisfies PublicUser & { uid: string; suspended: boolean };
}

export const USER_FIXTURES = [
  profile(PEOPLE.teacherA, 'teacher'),
  profile(PEOPLE.teacherB, 'teacher'),
  profile(PEOPLE.studentA, 'student'),
  profile(PEOPLE.studentB, 'student'),
  profile(PEOPLE.outsiderStudent, 'student'),
];

export const COURSE_A: CourseRecord = {
  id: 'course-a',
  slug: 'course-a',
  name: 'Course A',
  institution: 'ITD',
  term: 'Ago–Dic 2026',
  description: '',
  teacherName: PEOPLE.teacherA.displayName,
  studentCount: 2,
  projectCount: 0,
  activities: [],
  code: 'AAA234',
  academicPeriod: 'Ago–Dic 2026',
  teachers: [PEOPLE.teacherA],
  students: [PEOPLE.studentA, PEOPLE.studentB],
  visibility: 'private',
  createdBy: PEOPLE.teacherA.uid,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const COURSE_B: CourseRecord = {
  ...COURSE_A,
  id: 'course-b',
  slug: 'course-b',
  name: 'Course B',
  teacherName: PEOPLE.teacherB.displayName,
  studentCount: 0,
  code: 'BBB234',
  teachers: [PEOPLE.teacherB],
  students: [],
  createdBy: PEOPLE.teacherB.uid,
};

export const COURSE_FIXTURES = [COURSE_A, COURSE_B];
