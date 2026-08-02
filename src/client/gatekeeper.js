// Gatekeeper item — farm login-to-view control panel.
// Talks to /plugin/gatekeeper/* on the origin serving the page. All writes
// are admin-gated server-side; non-admins get a read-only notice.

const post = (endpoint, body) =>
  fetch(`/plugin/gatekeeper/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  })

const esc = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const styles = `
  .gatekeeper { font-size: 90%; }
  .gatekeeper table { width: 100%; border-collapse: collapse; }
  .gatekeeper th, .gatekeeper td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #eee; }
  .gatekeeper .pending { background: #f5a623; color: #fff; border-radius: 8px; padding: 0 7px; font-size: 85%; }
  .gatekeeper .warning { color: #c0392b; font-size: 85%; }
  .gatekeeper .ids, .gatekeeper .pub, .gatekeeper .terms { cursor: pointer; border-bottom: 1px dotted #999; }
  .gatekeeper .terms { font-size: 85%; color: #888; }
  .gatekeeper .remove { cursor: pointer; color: #c0392b; border: 0; background: none; }
  .gatekeeper .bar { display: flex; gap: 6px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
  .gatekeeper input[type=text] { flex: 1; min-width: 10em; padding: 2px 6px; }
  .gatekeeper button { padding: 2px 10px; }
  .gatekeeper .status { margin-top: 6px; font-size: 85%; color: #666; min-height: 1.2em; }
  .gatekeeper .status.err { color: #c0392b; }
  .gatekeeper .status.ok { color: #27ae60; }
`

const emit = (div, item) => {
  div.html(`<style>${styles}</style><div class="gatekeeper"><p>Gatekeeper — loading…</p></div>`)
}

const bind = (div, item) => {
  const root = () => div.find('.gatekeeper')
  const say = (msg, cls) => root().find('.status').attr('class', `status ${cls || ''}`).text(msg)

  const render = data => {
    const rows = (data.sites || [])
      .map(site => {
        if (site.removed)
          return `<tr><td>${esc(site.host)}</td><td colspan="4"><em>removed from config</em></td>
            <td><span class="pending">pending restart</span></td><td></td></tr>`
        const pub = (site.public_pages || []).join(', ')
        const terms = site.require_terms || ''
        return `<tr data-host="${esc(site.host)}">
          <td>${esc(site.host)}</td>
          <td><input type="checkbox" class="restricted" ${site.restricted ? 'checked' : ''}></td>
          <td><span class="ids" title="click to edit allowed ids">${esc((site.allowed_ids || []).join(' ') || '—')}</span></td>
          <td><span class="pub" title="click to edit the public (blessed) pages">${esc(pub || '—')}</span>
            <div><span class="terms" title="click to set the must-read-before-login page">terms: ${esc(terms || '—')}</span></div></td>
          <td>${site.warnings.map(w => `<div class="warning">⚠ ${esc(w)}</div>`).join('')}</td>
          <td>${site.pending ? '<span class="pending">pending restart</span>' : ''}</td>
          <td><button class="remove" title="remove site from config">×</button></td>
        </tr>`
      })
      .join('')
    const anyPending =
      data.configEditedSinceBoot || (data.sites || []).some(site => site.pending)
    root().html(`
      <table>
        <tr><th>site</th><th>login-to-view</th><th>allowed ids</th><th>public pages</th><th></th><th></th><th></th></tr>
        ${rows || '<tr><td colspan="7"><em>no wikiDomains entries in the config yet</em></td></tr>'}
      </table>
      <div class="bar">
        <input type="text" class="new-host" placeholder="add a site, e.g. private.example.com">
        <button class="add">add</button>
        ${anyPending ? '<button class="restart">restart farm</button>' : ''}
      </div>
      <div class="status"></div>
    `)
    if (anyPending)
      say(
        data.supervised
          ? 'Config changed since the farm started — restart to apply.'
          : 'Config changed — no supervisor detected; restart with wiki-start --restart (button will offer force).'
      )
  }

  const refresh = () =>
    fetch('/plugin/gatekeeper/status.json', { credentials: 'include', cache: 'no-store' })
      .then(r => {
        if (r.status === 403) throw Object.assign(new Error('admin'), { admin: true })
        return r.json()
      })
      .then(data => {
        if (data.error && data.readOnly) {
          root().html(`<p><em>${esc(data.error)}</em></p>`)
          return
        }
        lastStarted = data.processStarted
        render(data)
      })
      .catch(e => {
        if (e.admin)
          root().html('<p><em>Gatekeeper needs an admin login — log in with the site secret first.</em></p>')
        else root().html(`<p><em>gatekeeper unreachable: ${esc(e.message)}</em></p>`)
      })

  let lastStarted = null

  const pollUntilBack = () => {
    const began = Date.now()
    say('restarting…')
    const tick = () => {
      if (Date.now() - began > 120000) {
        say('server did not come back within 2 minutes — check the supervisor.', 'err')
        return
      }
      fetch('/plugin/gatekeeper/ping.json', { cache: 'no-store' })
        .then(r => r.json())
        .then(pong => {
          if (pong.started && pong.started !== lastStarted) {
            say('back up ✓', 'ok')
            setTimeout(refresh, 800)
          } else setTimeout(tick, 2000)
        })
        .catch(() => setTimeout(tick, 2000))
    }
    setTimeout(tick, 2000)
  }

  div.on('change', '.restricted', e => {
    const host = e.target.closest('tr').dataset.host
    post('toggle', { host, restricted: e.target.checked })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.ids', e => {
    const host = e.target.closest('tr').dataset.host
    const current = e.target.textContent === '—' ? '' : e.target.textContent
    const entered = prompt(
      `Allowed ids for ${host} — space-separated ("*" = any logged-in user, empty = clear):`,
      current
    )
    if (entered == null) return
    const allowed_ids = entered.trim() ? entered.trim().split(/[\s]+/) : []
    post('allowed', { host, allowed_ids })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.pub', e => {
    const host = e.target.closest('tr').dataset.host
    const current = e.target.textContent === '—' ? '' : e.target.textContent
    const entered = prompt(
      `Public (blessed) pages for ${host} — comma-separated page names a logged-out visitor may read (empty = splash only):`,
      current
    )
    if (entered == null) return
    const public_pages = entered.trim()
      ? entered.split(',').map(s => s.trim()).filter(Boolean)
      : []
    post('allowed', { host, public_pages })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.terms', e => {
    const host = e.target.closest('tr').dataset.host
    const current = e.target.textContent.replace(/^terms:\s*/, '')
    const entered = prompt(
      `Must-read-before-login page for ${host} — a page name, "true" for site-terms, empty to clear:`,
      current === '—' ? '' : current
    )
    if (entered == null) return
    post('allowed', { host, require_terms: entered.trim() })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.remove', e => {
    const host = e.target.closest('tr').dataset.host
    if (!confirm(`Remove ${host} from the farm config's wikiDomains? (site data is untouched)`)) return
    post('site', { host, action: 'remove' })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.add', () => {
    const host = (div.find('.new-host').val() || '').trim().toLowerCase()
    if (!host) return
    post('site', { host, action: 'add' })
      .then(r => (r.ok ? refresh() : r.json().then(b => say(b.error, 'err'))))
      .catch(e2 => say(e2.message, 'err'))
  })

  div.on('click', '.restart', () => {
    div.find('button, input').attr('disabled', 'disabled')
    post('restart').then(r => {
      if (r.ok) return pollUntilBack()
      if (r.status === 409)
        return r.json().then(b => {
          if (confirm(`${b.error}\n\n${b.hint}\n\nForce the exit anyway?`))
            post('restart', { force: true }).then(r2 =>
              r2.ok ? pollUntilBack() : say('restart refused', 'err')
            )
          else {
            div.find('button, input').removeAttr('disabled')
            say('restart cancelled — use wiki-start --restart from a shell.', 'err')
          }
        })
      return r.json().then(b => say(b.error || 'restart failed', 'err'))
    })
  })

  refresh()
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins['gatekeeper'] = { emit, bind }
}

export { emit, bind }
