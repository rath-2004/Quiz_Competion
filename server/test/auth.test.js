import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { app, pool, registerStudent, request, resetDatabase } from './helpers.js';

let departmentIds;

beforeEach(async () => {
  ({ departmentIds } = await resetDatabase());
});

after(() => pool.end());

describe('student registration and login', () => {
  test('registers a student and returns their profile with the session cookie', async () => {
    const { agent, student } = await registerStudent(departmentIds[0], { registerNo: 'cs-21/045' });
    assert.equal(student.registerNo, 'CS-21/045');
    assert.equal(student.department, 'Computer Science');
    assert.equal(student.passwordHash, undefined);
    const me = await agent.get('/api/auth/student/me').expect(200);
    assert.equal(me.body.student.id, student.id);
  });

  test('rejects duplicate email and register number with clear messages', async () => {
    await registerStudent(departmentIds[0], { email: 'dup@test.local', registerNo: 'DUP1' });
    const sameEmail = await request(app)
      .post('/api/auth/student/register')
      .send({ name: 'Other', email: 'DUP@test.local', registerNo: 'X1', phone: '9999999999', departmentId: departmentIds[0], yearOfStudy: 1, password: 'password1' })
      .expect(409);
    assert.match(sameEmail.body.error, /email already exists/);
    const sameReg = await request(app)
      .post('/api/auth/student/register')
      .send({ name: 'Other', email: 'new@test.local', registerNo: 'dup1', phone: '9999999999', departmentId: departmentIds[0], yearOfStudy: 1, password: 'password1' })
      .expect(409);
    assert.match(sameReg.body.error, /register number is already registered/);
  });

  test('validates required fields', async () => {
    const res = await request(app)
      .post('/api/auth/student/register')
      .send({ name: 'A', email: 'bad', registerNo: '', phone: '12', departmentId: departmentIds[0], yearOfStudy: 9, password: 'short' })
      .expect(400);
    const fields = res.body.details.map((d) => d.field);
    for (const f of ['name', 'email', 'registerNo', 'phone', 'yearOfStudy', 'password']) assert.ok(fields.includes(f), f);
  });

  test('logs in with either register number or email', async () => {
    const { data } = await registerStudent(departmentIds[1]);
    await request(app).post('/api/auth/student/login').send({ identifier: data.registerNo.toLowerCase(), password: data.password }).expect(200);
    await request(app).post('/api/auth/student/login').send({ identifier: data.email, password: data.password }).expect(200);
    await request(app).post('/api/auth/student/login').send({ identifier: data.email, password: 'wrong-pass' }).expect(401);
    await request(app).post('/api/auth/student/login').send({ identifier: 'nobody', password: 'wrong-pass' }).expect(401);
  });

  test('blocked students cannot log in', async () => {
    const { student, data } = await registerStudent(departmentIds[0]);
    const admin = request.agent(app);
    await admin.post('/api/auth/admin/login').send({ email: 'admin@test.local', password: 'admin-password' }).expect(200);
    await admin.post(`/api/admin/students/${student.id}/block`).send({ blocked: true }).expect(200);
    const res = await request(app).post('/api/auth/student/login').send({ identifier: data.email, password: data.password }).expect(403);
    assert.match(res.body.error, /blocked/);
  });
});

describe('admin access', () => {
  test('admin endpoints reject anonymous users and students', async () => {
    await request(app).get('/api/admin/stats').expect(401);
    const { agent } = await registerStudent(departmentIds[0]);
    await agent.get('/api/admin/stats').expect(401);
  });

  test('admin can log in and see dashboard stats', async () => {
    await registerStudent(departmentIds[0]);
    const admin = request.agent(app);
    await admin.post('/api/auth/admin/login').send({ email: 'ADMIN@test.local', password: 'admin-password' }).expect(200);
    const stats = await admin.get('/api/admin/stats').expect(200);
    assert.equal(stats.body.totals.students, 1);
    assert.equal(stats.body.totals.departments, 2);
  });

  test('departments with students cannot be deleted', async () => {
    await registerStudent(departmentIds[0]);
    const admin = request.agent(app);
    await admin.post('/api/auth/admin/login').send({ email: 'admin@test.local', password: 'admin-password' }).expect(200);
    await admin.delete(`/api/admin/departments/${departmentIds[0]}`).expect(409);
    await admin.delete(`/api/admin/departments/${departmentIds[1]}`).expect(200);
  });
});
