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
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
  return JSON.stringify({ error: 'Unknown GitHub action' });
}

module.exports = { handleGitHubTool };
