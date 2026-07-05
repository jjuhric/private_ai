const { handleGitHubTool } = require('../tools/github_tool');

global.fetch = jest.fn();

describe('GitHub Tool Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list_repos action - with token', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { full_name: 'test/repo1', html_url: 'https://github.com/test/repo1', description: 'desc1' }
      ]
    });

    const result = await handleGitHubTool('token123', 'list_repos', {});
    const parsed = JSON.parse(result);

    expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/user/repos?sort=updated&per_page=5', expect.any(Object));
    expect(parsed).toEqual([
      { name: 'test/repo1', url: 'https://github.com/test/repo1', description: 'desc1' }
    ]);
  });

  test('list_repos action - without token public fallback', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { full_name: 'public/repo', html_url: 'https://github.com/public/repo', description: 'desc' }
      ]
    });

    const result = await handleGitHubTool(null, 'list_repos', {});
    const parsed = JSON.parse(result);

    expect(global.fetch).toHaveBeenCalledWith('https://api.github.com/repositories?per_page=5', expect.any(Object));
    expect(parsed.length).toBe(1);
  });

  test('get_repo action - success and parameters validation', async () => {
    // Missing parameters
    const errResult = await handleGitHubTool('token', 'get_repo', {});
    expect(JSON.parse(errResult)).toHaveProperty('error', 'Owner and repo are required');

    // Success path
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        full_name: 'owner/myrepo',
        description: 'a test repo',
        stargazers_count: 42,
        forks_count: 5
      })
    });

    const result = await handleGitHubTool('token', 'get_repo', { owner: 'owner', repo: 'myrepo' });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      name: 'owner/myrepo',
      desc: 'a test repo',
      stars: 42,
      forks: 5
    });
  });

  test('list_issues action - success and parameter checks', async () => {
    const errResult = await handleGitHubTool('token', 'list_issues', {});
    expect(JSON.parse(errResult)).toHaveProperty('error', 'Owner and repo are required');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { number: 1, title: 'Bug 1', state: 'open', html_url: 'https://github.com/owner/repo/issues/1' }
      ]
    });

    const result = await handleGitHubTool('token', 'list_issues', { owner: 'owner', repo: 'repo' });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([
      { number: 1, title: 'Bug 1', state: 'open', url: 'https://github.com/owner/repo/issues/1' }
    ]);
  });

  test('handles network and api errors', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Forbidden'
    });

    const result = await handleGitHubTool('token', 'list_repos', {});
    expect(JSON.parse(result)).toHaveProperty('error', 'GitHub error: Forbidden');
  });

  test('unknown github action', async () => {
    const result = await handleGitHubTool('token', 'unknown', {});
    expect(JSON.parse(result)).toHaveProperty('error', 'Unknown GitHub action');
  });

  test('create_branch action', async () => {
    // Mock getRef
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'base_sha_123' } })
    });
    // Mock createRef
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    });

    const result = await handleGitHubTool('token', 'create_branch', { owner: 'owner', repo: 'repo', branch: 'new_branch' });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.sha).toBe('base_sha_123');
  });

  test('commit_files action', async () => {
    // Mock file check (not found)
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404
    });
    // Mock commit
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    });

    const result = await handleGitHubTool('token', 'commit_files', {
      owner: 'owner',
      repo: 'repo',
      branch: 'branch',
      files: [{ path: 'file.js', content: 'base64_content' }],
      message: 'commit msg'
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
  });

  test('create_pr action', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/pr/1', number: 1 })
    });

    const result = await handleGitHubTool('token', 'create_pr', {
      owner: 'owner',
      repo: 'repo',
      title: 'PR title',
      head: 'branch',
      body: 'PR body'
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.url).toBe('https://github.com/pr/1');
  });
});
