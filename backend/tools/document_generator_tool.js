const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');
const { JWT_SECRET } = require('../middleware/auth');
const { markdownToBlocks } = require('../utils/markdownToBlocks');

const HEADING_SIZES = { 1: 20, 2: 16, 3: 13 };
const DOCX_HEADING_LEVELS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

/**
 * Handles document generation tool calls from worker agents.
 *
 * @param {import('sqlite').Database} db SQLite DB instance
 * @param {number} userId The user's ID
 * @param {string} action 'generate_pdf' | 'generate_docx' | 'generate_xlsx' | 'generate_pptx'
 * @param {object} params Action-specific parameters
 * @returns {Promise<string>} Text result for the worker agent (directive success string, or "Error: ...")
 */
async function handleDocumentGeneratorTool(db, userId, action, params = {}) {
  if (!db) {
    return 'Error: Database connection is not available.';
  }

  try {
    const { filename, title } = params;
    if (!filename || typeof filename !== 'string' || !filename.trim()) {
      return 'Error: "filename" parameter is required.';
    }

    let buffer;
    let ext;

    if (action === 'generate_pdf' || action === 'generate_docx') {
      const { content } = params;
      if (!content || typeof content !== 'string' || !content.trim()) {
        return 'Error: "content" parameter is required for this action.';
      }
      const blocks = markdownToBlocks(content);
      ext = action === 'generate_pdf' ? 'pdf' : 'docx';
      buffer = ext === 'pdf' ? await buildPdf(title || filename, blocks) : await buildDocx(title || filename, blocks);
    } else if (action === 'generate_xlsx') {
      const { sheets } = params;
      if (!Array.isArray(sheets) || sheets.length === 0) {
        return 'Error: "sheets" parameter (array of { name, headers, rows }) is required for generate_xlsx.';
      }
      ext = 'xlsx';
      buffer = await buildXlsx(sheets);
    } else if (action === 'generate_pptx') {
      const { slides } = params;
      if (!Array.isArray(slides) || slides.length === 0) {
        return 'Error: "slides" parameter (array of { title, bullets }) is required for generate_pptx.';
      }
      ext = 'pptx';
      buffer = await buildPptx(title || filename, slides);
    } else {
      return `Error: Unknown Document Generator action "${action}".`;
    }

    const { docId, finalName } = await saveGeneratedDocument(db, userId, filename, ext, buffer);
    const dlToken = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '1h' });
    const downloadUrl = `/api/documents/${docId}/download?token=${dlToken}`;

    return `Document generated successfully. You MUST include this exact download link, byte-for-byte, in your final response as an HTML anchor tag per your formatting rules: <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer">Download ${finalName}</a>`;
  } catch (err) {
    console.error('Document generator tool error:', err);
    return `Error generating document: ${err.message}`;
  }
}

/**
 * Sanitizes the filename, writes the buffer to disk under a per-user
 * directory, and records the file in the generated_documents table.
 */
async function saveGeneratedDocument(db, userId, filename, ext, buffer) {
  const baseName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

  const userDir = path.join(process.cwd(), 'generated_documents', String(userId));
  fs.mkdirSync(userDir, { recursive: true });

  const filepath = path.join(userDir, `${Date.now()}_${finalName}`);
  fs.writeFileSync(filepath, buffer);

  const result = await db.run(
    'INSERT INTO generated_documents (user_id, filename, filepath, doc_type, file_size) VALUES (?, ?, ?, ?, ?)',
    [userId, finalName, filepath, ext, buffer.length]
  );

  return { docId: result.lastID, finalName };
}

function buildPdf(title, blocks) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(22).text(title, { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(11);

    renderBlocksToPdf(doc, blocks);

    doc.end();
  });
}

function renderBlocksToPdf(doc, blocks) {
  for (const block of blocks) {
    if (block.type === 'heading') {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(HEADING_SIZES[block.level] || 14);
      renderPdfRuns(doc, block.runs);
      doc.font('Helvetica').fontSize(11);
    } else if (block.type === 'bullet') {
      doc.fontSize(11).text('•  ', { continued: true });
      renderPdfRuns(doc, block.runs);
    } else {
      doc.fontSize(11).moveDown(0.3);
      renderPdfRuns(doc, block.runs);
    }
  }
}

function renderPdfRuns(doc, runs) {
  runs.forEach((run, i) => {
    const opts = { continued: i < runs.length - 1 };
    if (run.url) {
      doc.fillColor('#1a73e8').text(run.text, { ...opts, link: run.url, underline: true }).fillColor('black');
    } else {
      doc.text(run.text, opts);
    }
  });
}

async function buildDocx(title, blocks) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    ...blocks.map((block) => {
      const runs = block.runs.map((run) => run.url
        ? new ExternalHyperlink({ children: [new TextRun({ text: run.text, style: 'Hyperlink' })], link: run.url })
        : new TextRun(run.text));

      if (block.type === 'heading') {
        return new Paragraph({ heading: DOCX_HEADING_LEVELS[block.level] || HeadingLevel.HEADING_3, children: runs });
      }
      if (block.type === 'bullet') {
        return new Paragraph({ bullet: { level: 0 }, children: runs });
      }
      return new Paragraph({ children: runs, spacing: { after: 200 } });
    })
  ];

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function buildXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PATTI';

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet((sheet.name || 'Sheet1').slice(0, 31));
    if (Array.isArray(sheet.headers) && sheet.headers.length) {
      const headerRow = ws.addRow(sheet.headers);
      headerRow.font = { bold: true };
    }
    for (const row of sheet.rows || []) {
      ws.addRow(row);
    }
    ws.columns.forEach((col) => { col.width = 22; });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildPptx(title, slides) {
  const pptx = new PptxGenJS();

  const titleSlide = pptx.addSlide();
  titleSlide.addText(title || 'Presentation', { x: 0.5, y: 2.2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addText(slide.title || '', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
    const bulletItems = (slide.bullets || []).map((bullet) => ({ text: bullet, options: { bullet: true, breakLine: true } }));
    if (bulletItems.length) {
      s.addText(bulletItems, { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16 });
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buffer);
}

module.exports = { handleDocumentGeneratorTool, MIME_TYPES };
