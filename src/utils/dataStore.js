const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

let octokit = null;

function useGitHub() {
  return Boolean(
    process.env.GITHUB_TOKEN &&
      process.env.GITHUB_OWNER &&
      process.env.GITHUB_REPO
  );
}

function getOctokit() {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

async function readDataFile(filename) {
  if (useGitHub()) {
    const api = getOctokit();
    const filePath = `data/${filename}`;

    try {
      const { data } = await api.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: filePath,
      });

      if (Array.isArray(data) || !('content' in data)) {
        throw new Error(`Unexpected GitHub response for ${filePath}`);
      }

      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        sha: data.sha,
      };
    } catch (error) {
      if (error.status === 404) {
        return { content: '', sha: null };
      }
      throw error;
    }
  }

  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { content: '', sha: null };
  }

  return { content: fs.readFileSync(filePath, 'utf8'), sha: null };
}

async function writeDataFile(filename, content, sha, message) {
  if (useGitHub()) {
    const api = getOctokit();
    await api.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `data/${filename}`,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: sha || undefined,
    });
    return;
  }

  const filePath = path.join(DATA_DIR, filename);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * 여러 데이터 파일을 하나의 Git 커밋으로 저장합니다.
 * 잔액 차감과 재고 이동이 일부만 반영되는 것을 방지합니다.
 */
async function writeDataFiles(files, message) {
  if (files.length === 0) return;

  if (useGitHub()) {
    const api = getOctokit();
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';

    const { data: reference } = await api.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentSha = reference.object.sha;

    const { data: parentCommit } = await api.git.getCommit({
      owner,
      repo,
      commit_sha: parentSha,
    });

    const { data: tree } = await api.git.createTree({
      owner,
      repo,
      base_tree: parentCommit.tree.sha,
      tree: files.map(({ filename, content }) => ({
        path: `data/${filename}`,
        mode: '100644',
        type: 'blob',
        content,
      })),
    });

    const { data: commit } = await api.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.sha,
      parents: [parentSha],
    });

    await api.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: false,
    });
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const { filename, content } of files) {
    fs.writeFileSync(path.join(DATA_DIR, filename), content, 'utf8');
  }
}

module.exports = {
  readDataFile,
  writeDataFile,
  writeDataFiles,
  useGitHub,
};
