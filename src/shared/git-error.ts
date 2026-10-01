const IPC_PREFIX = /^Error invoking remote method '[^']+': Error:\s*/

const DNS_THREAD = /getaddrinfo\(\) thread failed to start/i

const DNS_HINT =
  'Git could not start its DNS resolver, so fetch, pull, and push cannot reach the remote. That happens when Windows variables such as SystemRoot are missing from the Git process, or when a VPN, proxy, or firewall blocks it. Try again. If it continues, pause the VPN and compare with the same command in a terminal.'

/** Turn an Electron IPC rejection or raw git stderr into a dialog message. */
export function humanGitError(raw: string): string {
  const text = raw.replace(IPC_PREFIX, '').trim()
  if (!DNS_THREAD.test(text)) return text
  if (text.includes(DNS_HINT)) return text
  const line =
    text.split(/\r?\n/).find((row) => DNS_THREAD.test(row))?.trim() ||
    text.split(/\r?\n/).find((row) => row.trim()) ||
    text
  return `${line}\n\n${DNS_HINT}`
}
