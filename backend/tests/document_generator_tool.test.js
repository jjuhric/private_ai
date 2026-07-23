const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { markdownToBlocks } = require('../utils/markdownToBlocks');

// pptxgenjs uses a dynamic import() internally for media-encoding node deps that
// Jest's CJS transform can't resolve without --experimental-vm-modules. Confirmed
// working correctly under plain Node (see manual verification) - this mock isolates
// our own tool logic (sanitization/DB insert/directive string) from that unrelated
// Jest/library environment incompatibility.
jest.mock('pptxgenjs', () => {
  return jest.fn().mockImplementation(() => ({
    addSlide: () => ({ addText: () => {} }),
    write: async () => Buffer.from('fake-pptx-bytes')
  }));
});

const { handleDocumentGeneratorTool } = require('../tools/document_generator_tool');

describe('markdownToBlocks', () => {
  test('parses headings, bullets, paragraphs, and inline links', () => {
    const blocks = markdownToBlocks(
      '# Title\n\nSome intro paragraph.\n\n- First point\n- Second point with a [link](https://example.com)\n\n## Section'
    );

    expect(blocks[0]).toEqual({ type: 'heading', level: 1, runs: [{ text: 'Title' }] });
    expect(blocks[1]).toEqual({ type: 'paragraph', runs: [{ text: 'Some intro paragraph.' }] });
    expect(blocks[2]).toEqual({ type: 'bullet', runs: [{ text: 'First point' }] });

    const linkedBullet = blocks[3];
    expect(linkedBullet.type).toBe('bullet');
    expect(linkedBullet.runs.some((r) => r.url === 'https://example.com' && r.text === 'link')).toBe(true);

    expect(blocks[4]).toEqual({ type: 'heading', level: 2, runs: [{ text: 'Section' }] });
  });

  test('returns an empty array for empty/whitespace-only input', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('   \n\n  ')).toEqual([]);
  });
});

describe('handleDocumentGeneratorTool', () => {
  let db;
  let userId;
  const generatedDir = path.join(process.cwd(), 'generated_documents');

  beforeAll(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await db.exec(schemaSql);

    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('docgenuser', 'hashed')");
    userId = result.lastID;
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(generatedDir)) {
      fs.rmSync(generatedDir, { recursive: true, force: true });
    }
  });

  test('returns an error string when the db is unavailable', async () => {
    const output = await handleDocumentGeneratorTool(null, userId, 'generate_pdf', { filename: 'x.pdf', content: 'hi' });
    expect(output).toMatch(/^Error:/);
  });

  test('returns an error string when filename is missing', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_pdf', { content: 'hi' });
    expect(output).toMatch(/^Error: "filename"/);
  });

  test('returns an error string when content is missing for generate_pdf', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_pdf', { filename: 'plan.pdf' });
    expect(output).toMatch(/^Error: "content"/);
  });

  test('returns an error string for an unknown action', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_something', { filename: 'a.txt', content: 'hi' });
    expect(output).toMatch(/Unknown Document Generator action/);
  });

  test('generate_pdf writes a file, inserts a DB row, and returns a directive download link', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_pdf', {
      filename: '../../evil name?.pdf',
      title: 'AWS AI Practitioner Study Plan',
      content: '# Week 1\n\n- Learn the basics\n- Read the [AWS AI Practitioner guide](https://aws.amazon.com/certification/certified-ai-practitioner/)'
    });

    expect(output).toContain('Document generated successfully');
    expect(output).toMatch(/<a href="\/api\/documents\/\d+\/download\?token=[^"]+" target="_blank" rel="noopener noreferrer">/);

    const row = await db.get('SELECT * FROM generated_documents WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    expect(row).toBeDefined();
    expect(row.doc_type).toBe('pdf');
    // Path traversal characters and the '?' must be stripped from the stored filename
    expect(row.filename).not.toMatch(/[./\\?]{2,}|\.\./);
    expect(row.filename.endsWith('.pdf')).toBe(true);
    expect(fs.existsSync(row.filepath)).toBe(true);
    expect(row.file_size).toBeGreaterThan(0);
  });

  test('generate_xlsx requires a non-empty sheets array', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_xlsx', { filename: 'plan.xlsx' });
    expect(output).toMatch(/^Error: "sheets"/);
  });

  test('generate_xlsx builds a workbook and saves it', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_xlsx', {
      filename: 'schedule.xlsx',
      sheets: [{ name: 'Week 1', headers: ['Day', 'Topic'], rows: [['Mon', 'IAM Basics']] }]
    });

    expect(output).toContain('Document generated successfully');
    const row = await db.get("SELECT * FROM generated_documents WHERE doc_type = 'xlsx' AND user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
    expect(row).toBeDefined();
    expect(fs.existsSync(row.filepath)).toBe(true);
  });

  test('generate_pptx requires a non-empty slides array', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_pptx', { filename: 'deck.pptx' });
    expect(output).toMatch(/^Error: "slides"/);
  });

  test('generate_pptx builds a deck and saves it', async () => {
    const output = await handleDocumentGeneratorTool(db, userId, 'generate_pptx', {
      filename: 'overview.pptx',
      title: 'AWS AI Practitioner Overview',
      slides: [{ title: 'Week 1', bullets: ['IAM basics', 'Shared responsibility model'] }]
    });

    expect(output).toContain('Document generated successfully');
    const row = await db.get("SELECT * FROM generated_documents WHERE doc_type = 'pptx' AND user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
    expect(row).toBeDefined();
    expect(fs.existsSync(row.filepath)).toBe(true);
  });
});
