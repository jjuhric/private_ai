const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const FAKE_SCRAPER_DIR = path.join(os.tmpdir(), 'fake_deep_research_scraper');
process.env.DEEP_RESEARCH_SCRAPER_DIR = FAKE_SCRAPER_DIR;

const mockBroadcastAlert = jest.fn();
jest.mock('../routes/alerts', () => ({ broadcastAlert: (...args) => mockBroadcastAlert(...args) }));

let lastSpawnedChild;
const mockSpawn = jest.fn(() => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  lastSpawnedChild = child;
  return child;
});
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args) => mockSpawn(...args)
}));

const { handleDeepResearchProTool, RESULTS_CHAT_TITLE } = require('../tools/deep_research_pro_tool');

describe('handleDeepResearchProTool', () => {
  let db;
  let userId;
  let tmpReportDir;

  beforeAll(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await db.exec(schemaSql);

    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('proresearchuser', 'hashed')");
    userId = result.lastID;

    tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drp-test-'));
  });

  afterAll(async () => {
    await db.close();
    fs.rmSync(tmpReportDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockSpawn.mockClear();
    mockBroadcastAlert.mockClear();
  });

  test('returns an error string when the db is unavailable', async () => {
    const output = await handleDeepResearchProTool(null, userId, 'start_research', { topic: 'x' });
    expect(output).toMatch(/^Error:/);
  });

  test('returns an error string when topic is missing', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'start_research', {});
    expect(output).toMatch(/^Error: "topic"/);
  });

  test('returns an error string for an unknown action', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'bogus_action', { topic: 'x' });
    expect(output).toMatch(/^Error: Unknown Deep Research Pro action/);
  });

  test('start_research spawns the python CLI with research-mode args and records a running job', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'Rust ownership' });

    expect(output).toMatch(/Started a deep research job on "Rust ownership"/);
    expect(output).toMatch(/Deep Research Results/);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [pythonExe, args, opts] = mockSpawn.mock.calls[0];
    expect(pythonExe).toContain(FAKE_SCRAPER_DIR);
    expect(args).toEqual(expect.arrayContaining(['research', 'Rust ownership', '--max-pages', '100', '--time-budget', '480']));
    expect(opts).toEqual({ cwd: FAKE_SCRAPER_DIR });

    const jobIdMatch = /job (\S+),/.exec(output);
    expect(jobIdMatch).not.toBeNull();
    const row = await db.get('SELECT * FROM deep_research_jobs WHERE job_id = ?', [jobIdMatch[1]]);
    expect(row).toMatchObject({ topic: 'Rust ownership', mode: 'research', status: 'running' });
  });

  test('study_guide mode spawns the study-guide subcommand with per-domain args', async () => {
    await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'AWS AI Practitioner', mode: 'study_guide' });

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining([
      'study-guide', 'AWS AI Practitioner',
      '--max-pages-per-domain', '20', '--depth-per-domain', '3', '--time-budget-per-domain', '240'
    ]));
  });

  test('on successful completion, posts the report into the Deep Research Results chat and broadcasts an alert', async () => {
    const reportPath = path.join(tmpReportDir, 'rust-report.md');
    fs.writeFileSync(reportPath, '# Rust Ownership\n\nOwnership rules explained.', 'utf-8');

    const output = await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'Rust ownership deep dive' });
    const jobId = /job (\S+),/.exec(output)[1];

    lastSpawnedChild.stdout.emit('data', Buffer.from(`Report written to: ${reportPath}\n`));
    lastSpawnedChild.emit('close', 0);
    const row = await waitForJobStatus(db, jobId);
    expect(row.status).toBe('completed');
    expect(row.report_path).toBe(reportPath);

    const chat = await db.get('SELECT * FROM chats WHERE user_id = ? AND title = ?', [userId, RESULTS_CHAT_TITLE]);
    expect(chat).toBeTruthy();

    const message = await db.get(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1',
      [chat.id]
    );
    expect(message.content).toContain('Ownership rules explained.');
    expect(message.role).toBe('assistant');

    expect(mockBroadcastAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  test('on non-zero exit code, marks the job failed and posts a failure message instead', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'A topic that will fail' });
    const jobId = /job (\S+),/.exec(output)[1];

    lastSpawnedChild.emit('close', 1);
    const row = await waitForJobStatus(db, jobId);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/exited with code 1/);

    const chat = await db.get('SELECT * FROM chats WHERE user_id = ? AND title = ?', [userId, RESULTS_CHAT_TITLE]);
    const message = await db.get('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1', [chat.id]);
    expect(message.content).toMatch(/Deep research failed/);
    expect(mockBroadcastAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('on close with no parseable report path, marks the job failed', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'No report line topic' });
    const jobId = /job (\S+),/.exec(output)[1];

    lastSpawnedChild.stdout.emit('data', Buffer.from('some unrelated output\n'));
    lastSpawnedChild.emit('close', 0);
    const row = await waitForJobStatus(db, jobId);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/no report path/);
  });

  test('check_status with no jobs for a fresh user reports none started', async () => {
    const fresh = await db.run("INSERT INTO users (username, password_hash) VALUES ('freshuser', 'hashed')");
    const output = await handleDeepResearchProTool(db, fresh.lastID, 'check_status', {});
    expect(output).toMatch(/No deep research jobs/);
  });

  test('check_status with an unknown jobId returns an error', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'check_status', { jobId: 'does-not-exist' });
    expect(output).toMatch(/^Error: No job found/);
  });

  test('check_status returns the most recent job when no jobId is given', async () => {
    const output = await handleDeepResearchProTool(db, userId, 'start_research', { topic: 'Latest job topic' });
    const jobId = /job (\S+),/.exec(output)[1];

    const status = await handleDeepResearchProTool(db, userId, 'check_status', {});
    expect(status).toMatch(/Latest job topic/);
    expect(status).toMatch(/still running/);
    void jobId;
  });
});

// The 'close' handler in deep_research_pro_tool.js is deliberately fire-and-forget
// (nothing awaits child-process completion synchronously, matching real usage), so
// tests must poll for the job to leave 'running' rather than assuming a fixed number
// of promise/microtask ticks is enough - a chain of several real sqlite awaits can
// take more than one setImmediate cycle to fully settle.
async function waitForJobStatus(db, jobId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.get('SELECT * FROM deep_research_jobs WHERE job_id = ?', [jobId]);
    if (row && row.status !== 'running') return row;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${jobId} to leave 'running' status`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
