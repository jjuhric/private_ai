describe('handleDeepResearchProTool when DEEP_RESEARCH_SCRAPER_DIR is not set', () => {
  const originalDir = process.env.DEEP_RESEARCH_SCRAPER_DIR;
  const originalPython = process.env.DEEP_RESEARCH_SCRAPER_PYTHON;

  beforeAll(() => {
    delete process.env.DEEP_RESEARCH_SCRAPER_DIR;
    delete process.env.DEEP_RESEARCH_SCRAPER_PYTHON;
    jest.resetModules();
  });

  afterAll(() => {
    if (originalDir !== undefined) process.env.DEEP_RESEARCH_SCRAPER_DIR = originalDir;
    if (originalPython !== undefined) process.env.DEEP_RESEARCH_SCRAPER_PYTHON = originalPython;
  });

  test('returns a clear configuration error instead of throwing', async () => {
    const { handleDeepResearchProTool } = require('../tools/deep_research_pro_tool');
    const output = await handleDeepResearchProTool({ get: jest.fn(), run: jest.fn() }, 1, 'start_research', { topic: 'x' });
    expect(output).toMatch(/^Error: DEEP_RESEARCH_SCRAPER_DIR is not configured/);
  });
});
