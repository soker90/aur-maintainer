export async function requestGitHub(
  token: string,
  path: string,
  method = 'GET',
  body?: Record<string, string>
): Promise<unknown> {
  const response = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2026-03-10',
      'user-agent': 'aur-maintainer'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    )
  }

  return response.json()
}
