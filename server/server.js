// server/server.js — CommonJS (see sibling server/package.json).
// Gatekeeper: reads and writes the FARM config file (argv.config) to manage
// per-site login-to-view (the wikiDomains map's `restricted` keys), and
// restarts the farm Plugmatic-style (exit 0, supervisor respawns).
//
// Module-level state is shared by every per-site server in the farm process
// via the require cache: one snapshot of the config as the process booted,
// one write queue so concurrent edits never interleave.

const fs = require('node:fs')
const path = require('node:path')

const PROCESS_STARTED = Date.now() - process.uptime() * 1000
const BACKUPS_TO_KEEP = 20

// Keys the toggle/allowed routes may touch inside a wikiDomains entry.
const SITE_KEYS = [
  'restricted',
  'allowed_ids',
  'allowed_domains',
  'splash_page',
  'details',
  'public_pages',
  'require_terms',
]

let configPath = null
let bootSnapshot = null // config parsed when this module first loaded

// Serialise all read-modify-write cycles.
let writeQueue = Promise.resolve()

const readConfig = () => JSON.parse(fs.readFileSync(configPath, 'utf8'))

const detectIndent = raw => {
  const m = raw.match(/^(\s+)"/m)
  return m ? m[1] : '  '
}

// A supervisor respawns the process after exit 0: a container runtime, a
// systemd service (systemd sets INVOCATION_ID for every unit it runs; the
// unit must carry Restart=always, as the Pi5 farms do), or an operator
// saying so with WIKI_SUPERVISED=1. Named so the client can show which.
const supervisor = () =>
  process.env.WIKI_SUPERVISED === '1'
    ? 'env'
    : fs.existsSync('/.dockerenv')
      ? 'docker'
      : process.env.INVOCATION_ID
        ? 'systemd'
        : null
const supervised = () => supervisor() != null

const writeConfig = mutator =>
  (writeQueue = writeQueue.then(() => {
    const raw = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(raw)
    mutator(config)

    const dir = path.dirname(configPath)
    const backups = path.join(dir, 'config-backups')
    fs.mkdirSync(backups, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(configPath, path.join(backups, `${path.basename(configPath)}.${stamp}`))
    const old = fs
      .readdirSync(backups)
      .filter(f => f.startsWith(path.basename(configPath)))
      .sort()
    for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_TO_KEEP)))
      fs.rmSync(path.join(backups, f))

    // Same-directory tmp + rename = atomic on one filesystem; sync clients
    // (Nextcloud) never observe a half-written config.
    const tmp = path.join(dir, `.${path.basename(configPath)}.gatekeeper-tmp`)
    fs.writeFileSync(tmp, JSON.stringify(config, null, detectIndent(raw)) + '\n')
    fs.renameSync(tmp, configPath)
    return config
  }))

const validHost = h => typeof h === 'string' && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)
const validEntry = s => typeof s === 'string' && s.length > 0 && !s.includes(',')

const lint = site => {
  const warnings = []
  for (const key of ['allowed_ids', 'allowed_domains']) {
    const list = site[key]
    if (list == null) continue
    if (!Array.isArray(list)) warnings.push(`${key} is not an array`)
    else if (list.some(e => typeof e === 'string' && e.includes(',')))
      warnings.push(`${key} has a comma inside one entry — split it into separate entries; it can never match as-is`)
  }
  if (site.restricted != null && site.restricted !== 'true' && site.restricted !== 'terms')
    warnings.push(`restricted is ${JSON.stringify(site.restricted)} — any value restricts (upstream checks mere presence); use "true", "terms", or delete the key`)
  if (site.public_pages != null && !Array.isArray(site.public_pages))
    warnings.push('public_pages is not an array')
  return warnings
}

const validSlugName = s => typeof s === 'string' && s.trim().length > 0 && !s.includes(',')

const startServer = ({ argv, app }) => {
  if (!configPath && argv.config) {
    configPath = argv.config
    try {
      bootSnapshot = readConfig()
    } catch (e) {
      console.log('gatekeeper: could not parse config at boot:', e.message)
    }
  }

  const admin = (req, res, next) => {
    try {
      if (app.securityhandler && app.securityhandler.isAdmin(req)) return next()
    } catch {}
    res.status(403).json({ error: 'gatekeeper requires an admin login' })
  }

  // Unauthenticated liveness probe. `started` changing across polls is the
  // client's proof that the restart actually happened.
  app.get('/plugin/gatekeeper/ping.json', (req, res) => {
    res.json({ up: true, started: PROCESS_STARTED })
  })

  app.get('/plugin/gatekeeper/status.json', admin, (req, res) => {
    if (!configPath)
      return res.json({
        readOnly: true,
        error: 'no --config path in argv; gatekeeper cannot manage this farm',
        sites: [],
      })
    let config
    try {
      config = readConfig()
    } catch (e) {
      return res.status(500).json({ error: `config unreadable: ${e.message}` })
    }
    let configMtime = null
    try {
      configMtime = fs.statSync(configPath).mtimeMs
    } catch {}
    const domains = config.wikiDomains || {}
    const bootDomains = (bootSnapshot && bootSnapshot.wikiDomains) || {}
    const sites = Object.keys(domains).map(host => {
      const site = domains[host] || {}
      const pending =
        JSON.stringify(site) !== JSON.stringify(bootDomains[host] || {})
      return {
        host,
        restricted: site.restricted != null,
        allowed_ids: site.allowed_ids || null,
        allowed_domains: site.allowed_domains || null,
        splash_page: site.splash_page || null,
        details: site.details || null,
        public_pages: site.public_pages || null,
        require_terms: site.require_terms || null,
        security_type: site.security_type || null,
        pending,
        warnings: lint(site),
      }
    })
    // Sites removed from the file since boot are also a pending change.
    for (const host of Object.keys(bootDomains))
      if (!(host in domains))
        sites.push({ host, removed: true, pending: true, warnings: [] })
    res.json({
      configPath,
      farm: !!config.farm,
      security_type: config.security_type || null,
      processStarted: PROCESS_STARTED,
      configMtime,
      configEditedSinceBoot: configMtime != null && configMtime > PROCESS_STARTED,
      supervised: supervised(),
      supervisor: supervisor(),
      sites,
    })
  })

  app.post('/plugin/gatekeeper/toggle', admin, (req, res) => {
    if (!configPath) return res.status(500).json({ error: 'no config path' })
    const { host, restricted } = req.body || {}
    if (!validHost(host)) return res.status(400).json({ error: 'bad host' })
    writeConfig(config => {
      config.wikiDomains = config.wikiDomains || {}
      const site = (config.wikiDomains[host] = config.wikiDomains[host] || {})
      if (restricted) {
        site.restricted = 'true'
        // Any logged-in user may view unless the admin narrows it later.
        if (!site.allowed_ids && !site.allowed_domains) site.allowed_ids = ['*']
      } else {
        // Upstream checks mere presence of the key, so un-restrict = delete.
        delete site.restricted
      }
    })
      .then(() => res.json({ ok: true }))
      .catch(e => res.status(500).json({ error: e.message }))
  })

  app.post('/plugin/gatekeeper/allowed', admin, (req, res) => {
    if (!configPath) return res.status(500).json({ error: 'no config path' })
    const body = req.body || {}
    const { host } = body
    if (!validHost(host)) return res.status(400).json({ error: 'bad host' })
    for (const key of ['allowed_ids', 'allowed_domains'])
      if (body[key] != null && (!Array.isArray(body[key]) || !body[key].every(validEntry)))
        return res.status(400).json({ error: `${key} must be an array of comma-free strings` })
    for (const key of ['splash_page', 'details', 'require_terms'])
      if (body[key] != null && typeof body[key] !== 'string')
        return res.status(400).json({ error: `${key} must be a string` })
    if (body.public_pages != null &&
        (!Array.isArray(body.public_pages) || !body.public_pages.every(validSlugName)))
      return res.status(400).json({ error: 'public_pages must be an array of comma-free page names' })
    writeConfig(config => {
      config.wikiDomains = config.wikiDomains || {}
      const site = (config.wikiDomains[host] = config.wikiDomains[host] || {})
      for (const key of SITE_KEYS.filter(k => k !== 'restricted'))
        if (key in body) {
          const empty =
            body[key] == null ||
            (Array.isArray(body[key]) && body[key].length === 0) ||
            (typeof body[key] === 'string' && body[key].trim() === '')
          if (empty) delete site[key]
          else site[key] = body[key]
        }
    })
      .then(() => res.json({ ok: true }))
      .catch(e => res.status(500).json({ error: e.message }))
  })

  app.post('/plugin/gatekeeper/site', admin, (req, res) => {
    if (!configPath) return res.status(500).json({ error: 'no config path' })
    const { host, action } = req.body || {}
    if (!validHost(host)) return res.status(400).json({ error: 'bad host' })
    if (action !== 'add' && action !== 'remove')
      return res.status(400).json({ error: 'action must be add or remove' })
    writeConfig(config => {
      config.wikiDomains = config.wikiDomains || {}
      if (action === 'add') config.wikiDomains[host] = config.wikiDomains[host] || {}
      else delete config.wikiDomains[host]
    })
      .then(() => res.json({ ok: true }))
      .catch(e => res.status(500).json({ error: e.message }))
  })

  app.post('/plugin/gatekeeper/restart', admin, (req, res) => {
    if (!supervised() && !(req.body && req.body.force))
      return res.status(409).json({
        error: 'no supervisor detected — an exit would leave the farm down',
        hint: 'restart from a shell with: wiki-start --restart  (or POST again with {"force":true})',
      })
    console.log('gatekeeper: exit to restart')
    res.sendStatus(200)
    // Let the response flush before dying (plugmatic exits immediately and
    // the 200 usually — but not always — escapes the process).
    setTimeout(() => process.exit(0), 250)
  })
}

module.exports = { startServer }
