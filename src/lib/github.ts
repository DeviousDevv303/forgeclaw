import { Octokit } from '@octokit/rest'

export const createGithubClient = (token: string) => {
  return new Octokit({ auth: token })
}

export const createRepo = async (octokit: Octokit, name: string, description: string) => {
  const { data } = await octokit.repos.createForAuthenticatedUser({
    name,
    description,
    auto_init: true,
    private: false,
  })
  return data
}

export const pushFile = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string
) => {
  const encoded = btoa(unescape(encodeURIComponent(content)))
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encoded,
  })
}
