// utils/githubUpload.js
const fs = require('fs');
const path = require('path');

const OWNER = process.env.ASSET_GH_OWNER;
const REPO = process.env.ASSET_GH_REPO;
const BRANCH = process.env.ASSET_GH_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;

// return jsDelivr URL: https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>
function jsDelivrUrl(owner, repo, branch, filepath) {
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filepath}`;
}

// Lazy-load Octokit dynamically (works in CommonJS)
async function getOctokit() {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: TOKEN });
}

/**
 * Upload local file path to GitHub by creating/committing blob and tree.
 * Simplified approach: uses createOrUpdateFileContents (PUT /repos/{owner}/{repo}/contents/{path})
 */
async function uploadFileToGitHub(localFilePath, destPathInRepo) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error(
      'GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, and GITHUB_TOKEN in env'
    );
  }

  const octokit = await getOctokit();
  const content = fs.readFileSync(localFilePath, { encoding: 'base64' });

  try {
    // Check if file exists (to update)
    const existing = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: destPathInRepo,
      ref: BRANCH,
    });

    const sha = existing.data.sha;
    const commitMsg = `Update asset ${destPathInRepo} via Faculty Credit System`;

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: destPathInRepo,
      message: commitMsg,
      content,
      sha,
      branch: BRANCH,
    });

    return jsDelivrUrl(OWNER, REPO, BRANCH, destPathInRepo);
  } catch (err) {
    // If file not found, create it
    if (err.status === 404) {
      const commitMsg = `Add asset ${destPathInRepo} via Faculty Credit System`;

      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: destPathInRepo,
        message: commitMsg,
        content,
        branch: BRANCH,
      });

      return jsDelivrUrl(OWNER, REPO, BRANCH, destPathInRepo);
    }
    throw err;
  }
}

/**
 * Upload a file buffer directly to GitHub
 * @param {Buffer} buffer - file data
 * @param {string} destPathInRepo - path inside repo
 * @returns {Promise<string>} - CDN URL
 */
async function uploadFileToGitHubBuffer(buffer, destPathInRepo) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error('GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, GITHUB_TOKEN');
  }

  const octokit = await getOctokit();
  const content = buffer.toString('base64');

  try {
    const existing = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: destPathInRepo,
      ref: BRANCH,
    });

    const sha = existing.data.sha;
    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: destPathInRepo,
      message: `Update asset ${destPathInRepo}`,
      content,
      sha,
      branch: BRANCH,
    });

    return jsDelivrUrl(OWNER, REPO, BRANCH, destPathInRepo);
  } catch (err) {
    if (err.status === 404) {
      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: destPathInRepo,
        message: `Add asset ${destPathInRepo}`,
        content,
        branch: BRANCH,
      });

      return jsDelivrUrl(OWNER, REPO, BRANCH, destPathInRepo);
    }
    throw err;
  }
}


module.exports = { uploadFileToGitHub, uploadFileToGitHubBuffer, jsDelivrUrl };
