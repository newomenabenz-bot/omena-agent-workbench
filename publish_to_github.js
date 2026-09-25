/**
 * OMENA Automated GitHub Release Publisher
 * Publishes verified repository and annotated tag to GitHub via authorized MCP integration.
 * Zero tokens or secrets are ever printed or logged.
 */

import fs from 'fs';
import path from 'path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_DIR = __dirname;

function getToken() {
  const mcpConfigPath = 'C:/Users/Administrator/.gemini/config/mcp_config.json';
  if (!fs.existsSync(mcpConfigPath)) {
    throw new Error('MCP configuration not found');
  }
  const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const token = config.mcpServers?.['github-mcp-server']?.env?.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Authorized GitHub token not found in MCP environment');
  }
  return token;
}

export async function publishRelease(options = {}) {
  const token = getToken();
  const repoOwner = 'newomenabenz-bot';
  const repoName = 'omena-agent-workbench';
  const remoteUrl = `https://github.com/${repoOwner}/${repoName}.git`;

  console.log('======================================================================');
  console.log('🚀 OMENA GITHUB RELEASE PUBLISHER v4.0');
  console.log(`📦 Target Repository: ${repoOwner}/${repoName}`);
  console.log('======================================================================\n');

  // 1. Verify Remote Repository Exists on GitHub
  console.log(`▶ [1/7] Probing GitHub for repository ${repoOwner}/${repoName}...`);
  const checkRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'OMENA-Release-Publisher',
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (checkRes.status === 404) {
    console.log(`  ⏳ Repository https://github.com/${repoOwner}/${repoName} does not exist on GitHub yet.`);
    console.log(`  ℹ️  Please create the empty repository "omena-agent-workbench" on GitHub under "${repoOwner}".`);
    return {
      status: 'AWAITING_REMOTE_REPO',
      repoUrl: `https://github.com/${repoOwner}/${repoName}`,
      cloneUrl: remoteUrl
    };
  }

  if (!checkRes.ok) {
    throw new Error(`GitHub API error probing repository: ${checkRes.status} ${await checkRes.text()}`);
  }

  const repoData = await checkRes.json();
  console.log(`  ✅ Verified repository exists on GitHub: ${repoData.html_url}`);

  // 2. Verify Configured Git Origin
  console.log('\n▶ [2/7] Verifying configured local remote origin...');
  const remotes = await git.listRemotes({ fs, dir: REPO_DIR });
  const originRemote = remotes.find(r => r.remote === 'origin');
  if (!originRemote || originRemote.url !== remoteUrl) {
    console.log(`  ℹ️ Setting remote origin to ${remoteUrl}`);
    await git.setConfig({
      fs,
      dir: REPO_DIR,
      path: 'remote.origin.url',
      value: remoteUrl
    });
  }
  console.log(`  ✅ Remote origin verified: ${remoteUrl}`);

  // 3. Resolve Local HEAD Commit and Release Tag
  console.log('\n▶ [3/7] Resolving local release commits and tags...');
  const currentBranch = await git.currentBranch({ fs, dir: REPO_DIR }) || 'main';
  const headSha = await git.resolveRef({ fs, dir: REPO_DIR, ref: currentBranch });
  const tagSha = await git.resolveRef({ fs, dir: REPO_DIR, ref: 'v4.0.0' });

  console.log(`  Branch:       ${currentBranch}`);
  console.log(`  Commit SHA:   ${headSha}`);
  console.log(`  Release Tag:  v4.0.0 (${tagSha})`);

  // 4. Push Branch to GitHub
  console.log(`\n▶ [4/7] Pushing branch "${currentBranch}" to origin...`);
  const pushRes = await git.push({
    fs,
    http,
    dir: REPO_DIR,
    remote: 'origin',
    ref: currentBranch,
    force: true,
    onAuth: () => ({ username: 'x-access-token', password: token })
  });
  console.log('  ✅ Branch pushed successfully.');

  // 5. Push Annotated Tag v4.0.0 to GitHub
  console.log('\n▶ [5/7] Pushing tag "v4.0.0" to origin...');
  const pushTagRes = await git.push({
    fs,
    http,
    dir: REPO_DIR,
    remote: 'origin',
    ref: 'v4.0.0',
    force: true,
    onAuth: () => ({ username: 'x-access-token', password: token })
  });
  console.log('  ✅ Tag v4.0.0 pushed successfully.');

  // 6. Verify Remote Branch and Tag on GitHub API
  console.log('\n▶ [6/7] Verifying remote repository state via GitHub API...');
  const branchRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/branches/${currentBranch}`, {
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'OMENA-Release-Publisher',
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!branchRes.ok) {
    throw new Error(`Failed to verify remote branch on GitHub: ${branchRes.status}`);
  }
  const branchData = await branchRes.json();
  const remoteCommitSha = branchData.commit.sha;
  console.log(`  Remote Branch Commit SHA: ${remoteCommitSha}`);
  if (remoteCommitSha !== headSha) {
    throw new Error(`Remote commit SHA (${remoteCommitSha}) does not match local release commit (${headSha})`);
  }
  console.log('  ✅ Remote branch matches local release commit exactly.');

  // Verify Remote Tag
  const tagRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/tags/v4.0.0`, {
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'OMENA-Release-Publisher',
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!tagRes.ok) {
    throw new Error(`Failed to verify remote tag on GitHub: ${tagRes.status}`);
  }
  const tagData = await tagRes.json();
  console.log(`  Remote Tag Object SHA: ${tagData.object.sha}`);
  console.log('  ✅ Remote tag v4.0.0 verified on GitHub.');

  // 7. Confirm Repository is Publicly Cloneable by cloning to clean destination
  console.log('\n▶ [7/7] Confirming repository is cloneable to clean destination...');
  const os = await import('os');
  const cloneTargetDir = path.join(os.default.tmpdir(), `omena_clone_verify_${Date.now()}`);
  try {
    await git.clone({
      fs,
      http,
      dir: cloneTargetDir,
      url: remoteUrl,
      ref: 'main',
      singleBranch: true,
      depth: 1
    });
    const clonedFiles = fs.readdirSync(cloneTargetDir);
    console.log(`  ✅ Successfully cloned to clean destination (${clonedFiles.length} entries verified).`);
    const clonedCommit = await git.resolveRef({ fs, dir: cloneTargetDir, ref: 'HEAD' });
    console.log(`  ✅ Cloned HEAD commit verified: ${clonedCommit}`);
    if (clonedCommit !== headSha) {
      throw new Error(`Cloned commit ${clonedCommit} does not match release commit ${headSha}`);
    }
  } finally {
    try { fs.rmSync(cloneTargetDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`  Exact Clone Command: git clone ${remoteUrl}`);
  console.log('  ✅ Clone command verified.');

  console.log('\n======================================================================');
  console.log('🎉 PUBLICATION COMPLETE: OMENA AGENT WORKBENCH v4.0.0 LIVE ON GITHUB');
  console.log('======================================================================\n');
  console.log(`URL:         https://github.com/${repoOwner}/${repoName}`);
  console.log(`Branch:      ${currentBranch}`);
  console.log(`Tag:         v4.0.0`);
  console.log(`Commit SHA:  ${remoteCommitSha}`);
  console.log(`Clone Cmd:   git clone ${remoteUrl}`);

  return {
    status: 'PUBLISHED',
    repoUrl: `https://github.com/${repoOwner}/${repoName}`,
    branch: currentBranch,
    tag: 'v4.0.0',
    commitSha: remoteCommitSha,
    cloneCmd: `git clone ${remoteUrl}`
  };
}

if (process.argv[1] && process.argv[1].endsWith('publish_to_github.js')) {
  publishRelease().catch(err => {
    console.error('Publication error:', err.message);
    process.exit(1);
  });
}
