// GitHub tool operations
async function handleGitHubTool(token, action, params) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Private-AI-Assistant'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    if (action === 'list_repos') {
      const url = token 
        ? 'https://api.github.com/user/repos?sort=updated&per_page=5'
        : 'https://api.github.com/repositories?per_page=5'; // public fallback
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify(data.map(r => ({ name: r.full_name, url: r.html_url, description: r.description })));
    } else if (action === 'get_repo') {
      const { owner, repo } = params;
      if (!owner || !repo) return JSON.stringify({ error: 'Owner and repo are required' });
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify({ name: data.full_name, desc: data.description, stars: data.stargazers_count, forks: data.forks_count });
    } else if (action === 'list_issues') {
      const { owner, repo } = params;
      if (!owner || !repo) return JSON.stringify({ error: 'Owner and repo are required' });
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=5`, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify(data.map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })));
    } else if (action === 'create_branch') {
      const { owner, repo, branch, baseBranch = 'main' } = params;
      if (!owner || !repo || !branch) return JSON.stringify({ error: 'owner, repo, and branch are required' });
      
      // Get base ref SHA
      const getRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, { headers });
      if (!getRefRes.ok) throw new Error(`Failed to fetch base branch: ${getRefRes.statusText}`);
      const refData = await getRefRes.json();
      const baseSha = refData.object.sha;

      // Create branch
      const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: baseSha
        })
      });
      
      if (!createRefRes.ok && createRefRes.status !== 422) { // 422 usually means branch already exists
        throw new Error(`Failed to create branch: ${createRefRes.statusText}`);
      }
      
      return JSON.stringify({ success: true, message: `Branch "${branch}" created from "${baseBranch}"`, sha: baseSha });
    } else if (action === 'commit_files') {
      const { owner, repo, branch, files, message } = params;
      if (!owner || !repo || !branch || !files || !message) {
        return JSON.stringify({ error: 'owner, repo, branch, files, and message are required' });
      }

      for (const file of files) {
        // Check if file exists to get current sha
        let fileSha = undefined;
        const getFileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`, { headers });
        if (getFileRes.ok) {
          const fileData = await getFileRes.json();
          fileSha = fileData.sha;
        }

        // Commit file content
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message,
            content: file.content, // base64 encoded
            branch: branch,
            sha: fileSha
          })
        });

        if (!commitRes.ok) {
          throw new Error(`Failed to commit file "${file.path}": ${commitRes.statusText}`);
        }
      }

      return JSON.stringify({ success: true, message: `Successfully committed ${files.length} files to branch "${branch}"` });
    } else if (action === 'create_pr') {
      const { owner, repo, title, body, head, base = 'main' } = params;
      if (!owner || !repo || !title || !head) return JSON.stringify({ error: 'owner, repo, title, and head are required' });

      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          head,
          base
        })
      });

      if (!prRes.ok) {
        const errText = await prRes.text();
        throw new Error(`Failed to create PR: ${prRes.statusText} - ${errText}`);
      }
      
      const prData = await prRes.json();
      return JSON.stringify({ success: true, url: prData.html_url, number: prData.number });
    } else if (action === 'get_pr_status') {
      const { owner, repo, prNumber } = params;
      if (!owner || !repo || !prNumber) return JSON.stringify({ error: 'owner, repo, and prNumber are required' });

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers });
      if (!res.ok) throw new Error(`Failed to fetch PR: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify({ state: data.state, merged: data.merged });
    } else if (action === 'merge_pr') {
      const { owner, repo, prNumber } = params;
      if (!owner || !repo || !prNumber) return JSON.stringify({ error: 'owner, repo, and prNumber are required' });

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers
      });
      if (!res.ok) throw new Error(`Failed to merge PR: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify({ success: data.merged, message: data.message });
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
  return JSON.stringify({ error: 'Unknown GitHub action' });
}

module.exports = { handleGitHubTool };
