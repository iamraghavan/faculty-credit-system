// utils/githubUpload.js
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const OWNER = process.env.ASSET_GH_OWNER;
const REPO = process.env.ASSET_GH_REPO;
const BRANCH = process.env.ASSET_GH_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;

// return jsDelivr URL: https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>
function jsDelivrUrl(owner, repo, branch, filepath) {
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filepath}`;
}

/**
 * Upload local file path to GitHub by creating/committing blob and tree.
 * Simplified approach: uses createOrUpdateFileContents (PUT /repos/{owner}/{repo}/contents/{path})
 */
async function uploadFileToGitHub(localFilePath, destPathInRepo) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error('GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, and GITHUB_TOKEN in env');
  }

  const octokit = new Octokit({ auth: TOKEN });

  const content = fs.readFileSync(localFilePath, { encoding: 'base64' });

  // Check if file exists to get sha (update) else create
  try {
    const existing = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: destPathInRepo,
      ref: BRANCH
    });

    // Update the existing file
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
    // If not found -> create
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

module.exports = { uploadFileToGitHub, jsDelivrUrl };
