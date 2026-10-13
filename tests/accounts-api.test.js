import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirkam-member-http-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_TOKEN = 'test-admin';
const { createApp } = await import('../src/server.js');
const app = createApp();
beforeEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
async function enroll(identity = '123456789') {
  const r = await request(app).post('/api/accounts').set('Authorization', 'Bearer test-admin').send({ name: 'שם בדיקה', identity, prisonerNumber: '100', prison: 'בדיקה', verifiedBy: 'מנהל' });
  expect(r.status).toBe(200); return r.body;
}
async function login(r) {
  const response = await request(app).post('/member/login').send({ code: r.account.code, pin: r.pin });
  expect(response.status).toBe(200); return response.body.token;
}
describe('member access and draft HTTP flow', () => {
  it('requires administrator access for enrollment', async () => {
    expect((await request(app).post('/api/accounts').send({})).status).toBe(401);
    expect((await request(app).get('/member/drafts')).status).toBe(401);
  });
  it('returns a saved draft after logging in again', async () => {
    const r = await enroll(), first = await login(r);
    const created = await request(app).post('/member/drafts').set('Authorization', 'Bearer ' + first).send({});
    expect(created.status).toBe(200);
    await request(app).post('/member/logout').set('Authorization', 'Bearer ' + first);
    expect((await request(app).get('/member/drafts').set('Authorization', 'Bearer ' + first)).status).toBe(401);
    const second = await login(r);
    const listed = await request(app).get('/member/drafts').set('Authorization', 'Bearer ' + second);
    expect(listed.body.drafts[0].id).toBe(created.body.session.id);
  });
  it('prevents viewing, editing and downloading another member draft', async () => {
    const a = await login(await enroll()), b = await login(await enroll('987654321'));
    const created = await request(app).post('/member/drafts').set('Authorization', 'Bearer ' + a).send({});
    const id = created.body.session.id;
    for (const suffix of ['', '/pdf', '/docx']) {
      const response = await request(app).get('/member/drafts/' + id + suffix).set('Authorization', 'Bearer ' + b);
      expect(response.status).toBe(400); expect(response.body.error).toBe('הטיוטה לא נמצאה.');
    }
    expect((await request(app).post('/member/drafts/' + id + '/action').set('Authorization', 'Bearer ' + b).send({ action: 'pickCourt', data: { code: '2' } })).status).toBe(400);
  });
  it('keeps user credentials separate from the administration API', async () => {
    const token = await login(await enroll());
    expect((await request(app).get('/api/sessions').set('Authorization', 'Bearer ' + token)).status).toBe(401);
  });
  it('can return from court to menu and select the petition again without losing the draft', async () => {
    const token = await login(await enroll());
    const auth = 'Bearer ' + token;
    const created = await request(app).post('/member/drafts').set('Authorization', auth).send({});
    const route = '/member/drafts/' + created.body.session.id + '/action';
    const back = await request(app).post(route).set('Authorization', auth).send({action:'goBack'});
    expect(back.body.session.stage).toBe('menu');
    const selected = await request(app).post(route).set('Authorization', auth).send({action:'pickMenu',data:{digit:'2'}});
    expect(selected.status).toBe(200); expect(selected.body.session.stage).toBe('court');
    expect(selected.body.session.id).toBe(created.body.session.id);
  });
  it('refuses cross-origin login', async () => {
    expect((await request(app).post('/member/login').set('Origin','https://foreign.example').send({code:'123456',pin:'123456'})).status).toBe(403);
  });
});
