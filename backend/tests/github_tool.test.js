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

  describe('stage_feature_pr action tests', () => {
    test('stage_feature_pr action - success path', async () => {
      const cp = require('child_process');
      const originalExec = cp.exec;
      cp.exec = jest.fn((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        cb(null, 'mock stdout', 'mock stderr');
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/owner/repo/pull/1' })
      });

      const result = await handleGitHubTool('token', 'stage_feature_pr', {
        branchName: 'feat-new-tool',
        commitMessage: 'add cool tool',
        repoOwner: 'owner',
        repoName: 'repo',
        files: []
      });

      expect(result).toContain('GitHub Workflow Success');
      expect(result).toContain('https://github.com/owner/repo/pull/1');

      cp.exec = originalExec; // restore
    });

    test('stage_feature_pr action - blocked by test failure', async () => {
      const cp = require('child_process');
      const originalExec = cp.exec;
      cp.exec = jest.fn((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'npm run test:coverage') {
          cb(new Error('Test crashed'));
        } else {
          cb(null, 'mock stdout', 'mock stderr');
        }
      });

      const result = await handleGitHubTool('token', 'stage_feature_pr', {
        branchName: 'feat-new-tool',
        commitMessage: 'add cool tool',
        repoOwner: 'owner',
        repoName: 'repo',
        files: []
      });

      expect(result).toContain('GitHub Automation Blocked');

      cp.exec = originalExec; // restore
    });

    test('stage_feature_pr action - check out failure', async () => {
      const cp = require('child_process');
      const originalExec = cp.exec;
      cp.exec = jest.fn((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd.startsWith('git checkout')) {
          cb(new Error('Checkout failed'));
        } else {
          cb(null, 'mock stdout', 'mock stderr');
        }
      });

      const result = await handleGitHubTool('token', 'stage_feature_pr', {
        branchName: 'feat-new-tool',
        commitMessage: 'add cool tool',
        repoOwner: 'owner',
        repoName: 'repo',
        files: []
      });

      expect(result).toContain('Git Isolation Error');

      cp.exec = originalExec; // restore
    });
  });
});
