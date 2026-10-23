// A password-protected Git smart-HTTP server for tests: `git http-backend` behind Basic auth.
// Lets a test prove that clone / fetch / push ask the user for credentials.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

/** Serve the bare repos in `root` at http://127.0.0.1:<port>/<name>.git, but only to `user:pass`. */
export async function authGitServer(root, user, pass) {
  const attempts = []
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? ''
    const given = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : ''
    if (given) attempts.push(given)
    if (given !== `${user}:${pass}`) {
      req.resume()
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="spoon-test"' })
      return res.end('Unauthorized')
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const cgi = spawn('git', ['http-backend'], {
      windowsHide: true,
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        REMOTE_USER: user,
        REMOTE_ADDR: '127.0.0.1'
      }
    })
    req.pipe(cgi.stdin)
    let head = Buffer.alloc(0)
    let sent = false
    cgi.stdout.on('data', (chunk) => {
      if (sent) return void res.write(chunk)
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) return
      const headers = {}
      let status = 200
      for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
        const [key, ...rest] = line.split(':')
        if (/^status$/i.test(key)) status = Number.parseInt(rest.join(':'), 10)
        else headers[key] = rest.join(':').trim()
      }
      res.writeHead(status, headers)
      sent = true
      res.write(head.subarray(end + 4))
    })
    cgi.on('close', () => res.end())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, server, attempts }
}
