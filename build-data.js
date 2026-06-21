/* eslint-disable */
/**
 * build-data.js — Extracts a structured, hallucination-free model of The Graph
 * protocol contracts on this branch from compiled ABIs, pairs it with a curated
 * manifest (descriptions + dependency edges grounded in source), and emits
 * `data.js` consumed by index.html.
 *
 * Functions are classified read (view/pure) vs write (state-changing) straight
 * from each ABI's stateMutability. Events come straight from the ABI too.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const IFACE = path.join(ROOT, 'packages/interfaces/artifacts/contracts')
const CONTRACTS = path.join(ROOT, 'packages/contracts/artifacts/contracts')

// Resolve an interfaces-package ABI by its logical path, e.g. "horizon/IGraphPayments".
function ifaceAbi(logical) {
  const name = logical.split('/').pop()
  return path.join(IFACE, `${logical}.sol`, `${name}.json`)
}
// Resolve a contracts-package implementation ABI, e.g. "rewards/RewardsManager".
function implAbi(logical) {
  const name = logical.split('/').pop()
  return path.join(CONTRACTS, `${logical}.sol`, `${name}.json`)
}

function loadAbi(p) {
  if (!fs.existsSync(p)) {
    console.error('  ! missing ABI:', path.relative(ROOT, p))
    return []
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  return j.abi || []
}

function typeStr(input) {
  // Render a (possibly tuple) ABI type compactly.
  if (input.type.startsWith('tuple')) {
    const inner = (input.components || []).map(typeStr).join(',')
    const arr = input.type.slice('tuple'.length) // e.g. "[]" or ""
    return `(${inner})${arr}`
  }
  return input.type
}

function fnSignature(fn) {
  return `${fn.name}(${(fn.inputs || []).map((i) => typeStr(i)).join(',')})`
}

// NatSpec resolver: harvest @notice/@dev/@param/@return from compiled artifact
// metadata so every function and event can explain what it actually does.
function walkFiles(dir, ext, out) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, ext, out)
    else if (e.name.endsWith(ext)) out.push(p)
  }
}

function parseMeta(meta) {
  if (!meta) return null
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)
    } catch {
      return null
    }
  }
  return meta
}

// Fold one contract's devdoc/userdoc into the index under its name. First
// non-empty value wins, so richer impl docs are not clobbered by terse ones.
function ingestDoc(index, name, output) {
  if (!name || !output) return
  const dev = output.devdoc || {}
  const usr = output.userdoc || {}
  const slot = (index[name] = index[name] || { methods: {}, events: {}, contract: {} })
  if (dev.title && !slot.contract.title) slot.contract.title = dev.title
  if (dev.author && !slot.contract.author) slot.contract.author = dev.author
  if (usr.notice && !slot.contract.notice) slot.contract.notice = usr.notice
  if (dev.details && !slot.contract.details) slot.contract.details = dev.details
  for (const [sig, d] of Object.entries(dev.methods || {})) {
    const m = (slot.methods[sig] = slot.methods[sig] || {})
    if (d.details && !m.details) m.details = d.details
    if (d.params && !m.params) m.params = d.params
    if (d.returns && !m.returns) m.returns = d.returns
  }
  for (const [sig, d] of Object.entries(usr.methods || {})) {
    const m = (slot.methods[sig] = slot.methods[sig] || {})
    if (d.notice && !m.notice) m.notice = d.notice
  }
  for (const [sig, d] of Object.entries(dev.events || {})) {
    const ev = (slot.events[sig] = slot.events[sig] || {})
    if (d.details && !ev.details) ev.details = d.details
    if (d.params && !ev.params) ev.params = d.params
  }
  for (const [sig, d] of Object.entries(usr.events || {})) {
    const ev = (slot.events[sig] = slot.events[sig] || {})
    if (d.notice && !ev.notice) ev.notice = d.notice
  }
}

function buildDocIndex() {
  const index = {}
  const pkgs = path.join(ROOT, 'packages')
  let pkgDirs = []
  try {
    pkgDirs = fs.readdirSync(pkgs)
  } catch {
    return index
  }
  // Foundry artifacts and horizon's build/ both store metadata with NatSpec.
  const artifacts = []
  for (const pkg of pkgDirs) {
    walkFiles(path.join(pkgs, pkg, 'forge-artifacts'), '.json', artifacts)
    walkFiles(path.join(pkgs, pkg, 'build'), '.json', artifacts)
  }
  for (const f of artifacts) {
    if (f.endsWith('.dbg.json')) continue
    let j
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      continue
    }
    const md = parseMeta(j.metadata)
    if (!md || !md.output) continue
    const ct = md.settings && md.settings.compilationTarget
    const name = ct ? Object.values(ct)[0] : path.basename(f, '.json')
    ingestDoc(index, name, md.output)
  }
  // Hardhat build-info embeds the same metadata as a string per contract.
  const buildInfos = []
  for (const pkg of pkgDirs) walkFiles(path.join(pkgs, pkg, 'artifacts', 'build-info'), '.json', buildInfos)
  for (const f of buildInfos) {
    let j
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      continue
    }
    const contracts = j.output && j.output.contracts
    if (!contracts) continue
    for (const src of Object.keys(contracts)) {
      for (const name of Object.keys(contracts[src])) {
        const md = parseMeta(contracts[src][name].metadata)
        if (md && md.output) ingestDoc(index, name, md.output)
      }
    }
  }
  return index
}

// The implementation contract name(s) to look up docs/source under, and the
// interface names that declare its functions and events.
function implNamesFor(m) {
  const out = []
  const fw = (m.name || '').split(/[ (]/)[0]
  if (fw) out.push(fw)
  if (m.id && !out.includes(m.id)) out.push(m.id)
  return out
}
function ifaceNamesFor(m) {
  const names = new Set()
  for (const a of m.abis) names.add(path.basename(a, '.json'))
  for (const impl of m.implements || []) {
    const w = impl.split(/[ (]/)[0]
    if (/^I[A-Z]/.test(w)) names.add(w)
  }
  return [...names]
}

// Merge a node's documentation from its implementation first (most complete via
// @inheritdoc), then its interfaces fill any gaps (events live there).
function resolveNodeDoc(index, m) {
  const merged = { methods: {}, events: {}, contract: {} }
  const implNames = implNamesFor(m)
  for (const nm of [...implNames, ...ifaceNamesFor(m)]) {
    const d = index[nm]
    if (!d) continue
    for (const [s, v] of Object.entries(d.methods)) {
      const t = (merged.methods[s] = merged.methods[s] || {})
      for (const k of ['notice', 'details', 'params', 'returns']) if (v[k] && !t[k]) t[k] = v[k]
    }
    for (const [s, v] of Object.entries(d.events)) {
      const t = (merged.events[s] = merged.events[s] || {})
      for (const k of ['notice', 'details', 'params']) if (v[k] && !t[k]) t[k] = v[k]
    }
    // Contract headline only from the implementation itself; an interface's
    // "Interface for X" blurb would misdescribe the deployed contract.
    if (implNames.includes(nm))
      for (const k of ['title', 'notice', 'details', 'author'])
        if (d.contract[k] && !merged.contract[k]) merged.contract[k] = d.contract[k]
  }
  return merged
}

// Source parser: roles and "who can call this" live in .sol modifiers, not the
// ABI, so we read them from source to show access control.
function buildSourceIndex() {
  const idx = {}
  const pkgs = path.join(ROOT, 'packages')
  let pkgDirs = []
  try {
    pkgDirs = fs.readdirSync(pkgs)
  } catch {
    return idx
  }
  const files = []
  for (const pkg of pkgDirs) walkFiles(path.join(pkgs, pkg, 'contracts'), '.sol', files)
  for (const f of files) {
    if (/[\\/](test|tests|mocks?)[\\/]/i.test(f)) continue
    let src
    try {
      src = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const re = /(?:^|\n)\s*(?:abstract\s+)?contract\s+(\w+)/g
    let mm
    while ((mm = re.exec(src))) if (!idx[mm[1]]) idx[mm[1]] = f
  }
  return idx
}

// Pull a single @tag's text out of a /** */ doc block (strips ` * ` margins).
function natspecTag(block, tag) {
  const flat = block
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
  const re = new RegExp('@' + tag + '\\s+([\\s\\S]*?)(?=@\\w+|$)')
  const m = flat.match(re)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

// Role constants + their NatSpec + admin role (from doc text or _setRoleAdmin).
function extractRoles(src) {
  const roles = []
  // Tempered match so the doc block can't swallow an earlier comment (e.g. the
  // contract's own @notice sitting above the first role constant).
  const docRe = /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*bytes32\s+(?:public|internal|private)\s+constant\s+(\w+)\s*=/g
  let mm
  while ((mm = docRe.exec(src))) {
    const notice = natspecTag(mm[1], 'notice')
    const dev = natspecTag(mm[1], 'dev')
    roles.push({ name: mm[2], notice, dev })
  }
  const bareRe = /bytes32\s+(?:public|internal|private)\s+constant\s+(\w+)\s*=\s*keccak256\(/g
  while ((mm = bareRe.exec(src))) if (!roles.find((r) => r.name === mm[1])) roles.push({ name: mm[1], notice: '', dev: '' })
  const adminRe = /_setRoleAdmin\(\s*(\w+)\s*,\s*(\w+)\s*\)/g
  const admin = {}
  while ((mm = adminRe.exec(src))) admin[mm[1]] = mm[2]
  for (const r of roles) {
    if (admin[r.name]) r.admin = admin[r.name]
    else {
      const m = (r.dev || '').match(/Admin(?:\s+of)?:\s*([A-Z_]+ROLE)/i)
      if (m) r.admin = m[1]
    }
  }
  return roles
}

// For each function: the roles it is gated behind and any guard modifiers.
function extractFnAccess(src) {
  const acc = {}
  const re = /function\s+(\w+)\s*\(([\s\S]*?)\)\s*([^{};]*?)(\{|;)/g
  let mm
  while ((mm = re.exec(src))) {
    const name = mm[1]
    const head = mm[3].split(/\breturns\b/)[0]
    const roles = []
    let r
    const orRe = /onlyRole\(\s*(\w+)\s*\)/g
    while ((r = orRe.exec(head))) roles.push(r[1])
    const mods = []
    for (const mod of ['whenNotPaused', 'whenPaused', 'nonReentrant', 'onlyGovernor', 'onlyController', 'onlyGateway'])
      if (new RegExp('\\b' + mod + '\\b').test(head)) mods.push(mod)
    if (!/\b(external|public)\b/.test(head)) continue
    if (roles.length || mods.length) acc[name] = { roles, mods }
  }
  return acc
}

// Roles + access for a node, merged from its impl source and (when inherited)
// the BaseUpgradeable common base that defines GOVERNOR/PAUSE/OPERATOR.
function resolveNodeRoles(sourceIndex, m) {
  let srcPath = null
  for (const nm of implNamesFor(m)) {
    if (sourceIndex[nm]) {
      srcPath = sourceIndex[nm]
      break
    }
  }
  if (!srcPath) return { roles: [], access: {} }
  let src = ''
  try {
    src = fs.readFileSync(srcPath, 'utf8')
  } catch {
    return { roles: [], access: {} }
  }
  let roles = extractRoles(src)
  let access = extractFnAccess(src)
  if (/BaseUpgradeable/.test(src) && sourceIndex.BaseUpgradeable) {
    const base = fs.readFileSync(sourceIndex.BaseUpgradeable, 'utf8')
    const baseRoles = extractRoles(base)
    for (const br of baseRoles) if (!roles.find((r) => r.name === br.name)) roles.push(br)
    access = { ...extractFnAccess(base), ...access }
  }
  // Which functions each role gates (by name), for the role detail view.
  for (const r of roles) {
    r.gates = Object.keys(access)
      .filter((fn) => (access[fn].roles || []).includes(r.name))
      .sort()
  }
  return { roles, access }
}

// Behavior parser: per function, the events it can emit and the contracts it
// calls — resolved transitively so a function that works through internal
// helpers still reports what those helpers do.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

// Map a Solidity interface/type name to the graph node(s) that implement it.
function buildTypeToNode(manifest) {
  const map = {}
  const add = (t, id) => (map[t] = map[t] || new Set()).add(id)
  for (const m of manifest) {
    for (const a of m.abis) add(path.basename(a, '.json'), m.id)
    for (const impl of m.implements || []) {
      const w = impl.split(/[ (]/)[0]
      if (/^I[A-Z]/.test(w)) add(w, m.id)
    }
  }
  return map
}

// Identifier -> declared interface type(s), from state vars, params and locals.
function buildTypeOf(src) {
  const typeOf = {}
  const re =
    /\b(I[A-Z]\w*)\s+(?:calldata\s+|memory\s+|storage\s+|public\s+|private\s+|internal\s+|external\s+|immutable\s+|constant\s+|override\s+)*([A-Za-z_]\w*)\b/g
  let m
  while ((m = re.exec(src))) (typeOf[m[2]] = typeOf[m[2]] || new Set()).add(m[1])
  return typeOf
}

// Pull every function body out of source by brace matching, keyed by name.
function extractBodies(src) {
  const bodies = {}
  const names = new Set()
  const re = /function\s+(\w+)\s*\(/g
  let m
  while ((m = re.exec(src))) {
    const name = m[1]
    let i = re.lastIndex - 1
    let depth = 0
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) {
        i++
        break
      }
    }
    let j = i
    while (j < src.length && src[j] !== '{' && src[j] !== ';') j++
    if (src[j] !== '{') continue
    let bd = 0
    const start = j
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') bd++
      else if (c === '}' && --bd === 0) {
        j++
        break
      }
    }
    bodies[name] = (bodies[name] || '') + '\n' + src.slice(start, j)
    names.add(name)
  }
  return { bodies, names }
}

// Candidate receiver types called within one body (IType(x).m() casts + typed idents).
function bodyCallTypes(body, typeOf) {
  const types = new Set()
  let m
  const castRe = /\b(I[A-Z]\w*)\s*\([^;{}]*?\)\s*\.\s*\w+\s*\(/g
  while ((m = castRe.exec(body))) types.add(m[1])
  const idRe = /\b([A-Za-z_]\w*)\s*\.\s*\w+\s*\(/g
  while ((m = idRe.exec(body))) {
    const s = typeOf[m[1]]
    if (s) s.forEach((t) => types.add(t))
  }
  return types
}

// Transitive emits + call targets for one function. depTargets/dispEvents bound
// the result to edges we actually draw and events we can actually show.
function fnBehavior(start, bodies, names, typeOf, typeToNode, depTargets, dispEvents) {
  const seen = new Set()
  const emits = new Set()
  const callTypes = new Set()
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    const body = bodies[cur]
    if (!body) continue
    let m
    const er = /\bemit\s+(\w+)/g
    while ((m = er.exec(body))) emits.add(m[1])
    bodyCallTypes(body, typeOf).forEach((t) => callTypes.add(t))
    const cr = /(?:^|[^.\w])(\w+)\s*\(/g
    while ((m = cr.exec(body))) if (names.has(m[1])) stack.push(m[1])
  }
  const callIds = new Set()
  callTypes.forEach((t) => (typeToNode[t] || new Set()).forEach((id) => depTargets.has(id) && callIds.add(id)))
  return { emits: [...emits].filter((e) => dispEvents.has(e)), calls: [...callIds] }
}

// Bodies + type table for a node's implementation and its inherited base.
function nodeBehaviorMaps(sourceIndex, m) {
  let srcPath = null
  for (const nm of implNamesFor(m)) if (sourceIndex[nm]) { srcPath = sourceIndex[nm]; break }
  if (!srcPath) return null
  let src
  try {
    src = stripComments(fs.readFileSync(srcPath, 'utf8'))
  } catch {
    return null
  }
  if (/BaseUpgradeable/.test(src) && sourceIndex.BaseUpgradeable) {
    try {
      src += '\n' + stripComments(fs.readFileSync(sourceIndex.BaseUpgradeable, 'utf8'))
    } catch {}
  }
  const { bodies, names } = extractBodies(src)
  return { bodies, names, typeOf: buildTypeOf(src) }
}

// Curated manifest: maps each deployable contract to the ABI(s) defining its
// external surface, plus layer/description/edges authored from the repo's
// wiring (Controller registry, GraphDirectory, Directory) and NatSpec.
const LAYERS = {
  token: { label: 'GRT Token', color: '#F5A623' },
  staking: { label: 'Horizon Staking', color: '#7C6CF0' },
  payments: { label: 'Horizon Payments', color: '#12B886' },
  service: { label: 'Subgraph Service', color: '#3B9DF8' },
  disputes: { label: 'Disputes', color: '#E8534B' },
  issuance: { label: 'Issuance & Rewards', color: '#E84393' },
  curation: { label: 'Curation & Discovery', color: '#16C7C0' },
  governance: { label: 'Governance', color: '#9AA6B2' },
  bridge: { label: 'L1 ↔ L2 Bridge', color: '#E8843C' },
  legacy: { label: 'Legacy & Periphery', color: '#7A8694' },
}

// Testnet (Arbitrum Sepolia, chain 421614) deployed addresses, read from the
// per-package addresses.json on this branch.
const ADDR = {
  L2GraphToken: '0xf8c05dCF59E8B28BFD5eed176C562bEbcfc7Ac04',
  HorizonStaking: '0x865365C425f3A593Ffe698D9c4E6707D14d51e08',
  GraphPayments: '0x57E70eC8905E26341d40aF60Dca56cDBA8C166E5',
  PaymentsEscrow: '0x4b5D3Da463F7E076bb7CDF5030960bf123245681',
  GraphTallyCollector: '0x382863e7B662027117449bd2c49285582bbBd21B',
  RecurringCollector: '0x0b18befc60455121ad66ae6e4a647955fcde3900',
  SubgraphService: '0xc24A3dAC5d06d771f657A48B20cE1a671B78f26b',
  DisputeManager: '0x7C9B82717f9433932507dF6EdA93A9678b258698',
  RewardsManager: '0x1F49caE7669086c8ba53CC35d1E9f80176d67E79',
  IssuanceAllocator: '0x76a0d75651d4db83f74ac502b86a0ae4e19ac38b',
  DirectAllocation: '0xa0eab4367d753314840c09313a5c6d27174bd541',
  RecurringAgreementManager: '0x590dbbbdb1b6261e39bcc1fe88bffc21c847a68e',
  RewardsEligibilityOracle: '0x6ba849fbd33257162552578b2a432d30784f2f80',
  L2Curation: '0xDe761f075200E75485F4358978FB4d1dC8644FD5',
  GraphCurationToken: '0x00FBd5D46FFAc54862c1Dd27BE08924BB17f5CDa',
  L2GNS: '0x3133948342F35b8699d8F94aeE064AbB76eDe965',
  SubgraphNFT: '0xF21Df5BbA7EB9b54D8F60C560aFb9bA63e6aED1A',
  SubgraphNFTDescriptor: '0x4032F7B6b27FfC9862106f826379DaB1716C71d7',
  ServiceRegistry: '0x888541878CbDDEd880Cd58c728f1Af5C47343F86',
  EthereumDIDRegistry: '0xF5f4cA61481558709AFa94AdEDa7B5F180f4AD59',
  Controller: '0x9DB3ee191681f092607035d9BDA6e59FbEaCa695',
  GraphProxyAdmin: '0x7474a6cc5fAeDEc620Db0fa8E4da6eD58477042C',
  EpochManager: '0x88b3C7f37253bAA1A9b95feAd69bD5320585826D',
  L2GraphTokenGateway: '0xB24Ce0f8c18c4DdDa584A7EeC132F49C966813bb',
  SubgraphAvailabilityManager: '0x71D9aE967d1f31fbbD1817150902de78f8f2f73E',
  AllocationExchange: '0x9BD4FBDa981D628AbA16F261f810dD59E5bAf9eA',
  L2Staking: '0x865365C425f3A593Ffe698D9c4E6707D14d51e08',
}

const MANIFEST = [
  // ----- GRT Token -----
  {
    id: 'L2GraphToken',
    name: 'L2GraphToken (GRT)',
    layer: 'token',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/l2/token/IL2GraphToken'), ifaceAbi('contracts/token/IGraphToken')],
    implements: ['IL2GraphToken', 'IGraphToken', 'ERC20', 'ERC20Burnable'],
    desc: 'The L2 version of the GRT ERC-20 token. It is the unit of value across the whole protocol: indexers stake it, curators signal with it, payers spend it, and the protocol mints it as indexing rewards. On L2 it can only be minted or burned by the token gateway (when bridging) and by the rewards/issuance system.',
    deps: [],
  },

  // ----- Horizon Staking -----
  {
    id: 'HorizonStaking',
    name: 'HorizonStaking',
    layer: 'staking',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('horizon/IHorizonStaking')],
    implements: ['IHorizonStaking', 'IHorizonStakingMain', 'IHorizonStakingBase'],
    desc: 'The heart of Graph Horizon. Service providers stake GRT and carve it into "provisions" locked to a specific verifier (data service) such as the Subgraph Service. Delegators add stake on top. It tracks provisions, thawing/withdrawal, delegation pools, and lets verifiers slash misbehaving providers. It replaced the older monolithic Staking contract at the same proxy.',
    deps: [
      { to: 'L2GraphToken', label: 'locks / moves staked GRT' },
      { to: 'Controller', label: 'reads protocol registry', kind: 'registry' },
    ],
  },

  // ----- Horizon Payments -----
  {
    id: 'GraphPayments',
    name: 'GraphPayments',
    layer: 'payments',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('horizon/IGraphPayments')],
    implements: ['IGraphPayments'],
    desc: 'The settlement router for Horizon payments. When a collector releases funds, GraphPayments splits the amount between the service provider, its delegators, a data-service cut, and a protocol burn, then routes each slice to the right place. It is the single place that knows how a payment is divided.',
    deps: [
      { to: 'HorizonStaking', label: 'pays providers & delegators' },
      { to: 'L2GraphToken', label: 'burns protocol cut' },
    ],
  },
  {
    id: 'PaymentsEscrow',
    name: 'PaymentsEscrow',
    layer: 'payments',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('horizon/IPaymentsEscrow')],
    implements: ['IPaymentsEscrow'],
    desc: 'Holds GRT that payers lock up in advance for a specific (payer, collector, receiver) relationship. Collectors draw down from these escrow accounts as work is delivered. Payers must signal a thawing period before they can withdraw unspent funds, which protects receivers from sudden rug-pulls.',
    deps: [
      { to: 'GraphPayments', label: 'forwards collected funds' },
      { to: 'L2GraphToken', label: 'custodies GRT' },
    ],
  },
  {
    id: 'GraphTallyCollector',
    name: 'GraphTallyCollector',
    layer: 'payments',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('horizon/IGraphTallyCollector')],
    implements: ['IGraphTallyCollector', 'IPaymentsCollector', 'IAuthorizable'],
    desc: 'Collects query-fee payments from a signed "Receipt Aggregate Voucher" (RAV). A gateway signs a RAV whose total only ever grows; the collector verifies the signature, works out the newly-owed amount since the last RAV, and pulls exactly that from escrow. This is how off-chain query fees settle on-chain.',
    deps: [
      { to: 'PaymentsEscrow', label: 'draws owed query fees' },
      { to: 'GraphPayments', label: 'triggers settlement' },
    ],
  },
  {
    id: 'RecurringCollector',
    name: 'RecurringCollector',
    layer: 'payments',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('horizon/IRecurringCollector')],
    implements: ['IRecurringCollector', 'IAgreementCollector', 'IPaymentsCollector', 'IAuthorizable'],
    desc: 'Collects payments on a schedule from a signed "Recurring Collection Agreement" (RCA) rather than a one-off voucher. It enforces a minimum gap between collections and can require eligibility checks and payer callbacks. This is the engine behind indexing-fee agreements that pay out repeatedly over time.',
    deps: [
      { to: 'PaymentsEscrow', label: 'draws scheduled payments' },
      { to: 'GraphPayments', label: 'triggers settlement' },
    ],
  },

  // ----- Subgraph Service -----
  {
    id: 'SubgraphService',
    name: 'SubgraphService',
    layer: 'service',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('subgraph-service/ISubgraphService')],
    implements: ['ISubgraphService', 'IDataService', 'IDataServiceFees', 'IDataServicePausable', 'IRewardsIssuer'],
    desc: 'The data service indexers register with to serve subgraphs under Horizon. Indexers provision stake here, open allocations against subgraph deployments, present proofs of indexing (POIs) to claim indexing rewards, and collect query fees. It ties together staking, payments, curation and rewards for the indexing business.',
    deps: [
      { to: 'HorizonStaking', label: 'reads provisions, slashes' },
      { to: 'GraphTallyCollector', label: 'collects query fees' },
      { to: 'RecurringCollector', label: 'collects indexing fees' },
      { to: 'Curation', label: 'pays curation cut' },
      { to: 'RewardsManager', label: 'claims indexing rewards' },
      { to: 'GraphPayments', label: 'defines payment types', kind: 'registry' },
    ],
  },
  {
    id: 'DisputeManager',
    name: 'DisputeManager',
    layer: 'disputes',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('subgraph-service/IDisputeManager')],
    implements: ['IDisputeManager'],
    desc: 'The court of the Subgraph Service. Anyone (a "fisherman") can post a deposit to dispute an indexer\'s query response or indexing claim. An arbitrator then accepts, rejects, or draws the dispute; accepted disputes slash the indexer\'s provisioned stake and reward the fisherman.',
    deps: [
      { to: 'SubgraphService', label: 'slashes via the service' },
      { to: 'HorizonStaking', label: 'reads provisioned stake' },
    ],
  },

  // ----- Issuance & Rewards -----
  {
    id: 'RewardsManager',
    name: 'RewardsManager',
    layer: 'issuance',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/rewards/IRewardsManager')],
    implements: ['IRewardsManager', 'IRewardsIssuer', 'IIssuanceTarget', 'IProviderEligibilityManagement'],
    desc: 'Accrues and hands out GRT indexing rewards in proportion to how much curation signal each subgraph has. On this branch it draws its issuance budget from the IssuanceAllocator, checks each indexer against the Rewards Eligibility Oracle before paying, and honours the Subgraph Availability Manager\'s allow/deny decisions per subgraph.',
    deps: [
      { to: 'L2GraphToken', label: 'mints rewards' },
      { to: 'Curation', label: 'reads signal per subgraph' },
      { to: 'SubgraphService', label: 'reads allocations', kind: 'registry' },
      { to: 'RewardsEligibilityOracle', label: 'checks indexer eligibility' },
      { to: 'IssuanceAllocator', label: 'pulls issuance budget' },
    ],
  },
  {
    id: 'IssuanceAllocator',
    name: 'IssuanceAllocator',
    layer: 'issuance',
    chain: 'L2',
    core: true,
    abis: [
      ifaceAbi('issuance/allocate/IIssuanceAllocationDistribution'),
      ifaceAbi('issuance/allocate/IIssuanceAllocationAdministration'),
      ifaceAbi('issuance/allocate/IIssuanceAllocationStatus'),
      ifaceAbi('issuance/allocate/IIssuanceAllocationData'),
    ],
    implements: [
      'IIssuanceAllocationDistribution',
      'IIssuanceAllocationAdministration',
      'IIssuanceAllocationStatus',
    ],
    desc: 'Splits the protocol\'s GRT issuance across several "targets" while holding a 100% allocation invariant via a default target. Each target gets either freshly-minted tokens or a notification to mint its own. This is the new programmable issuance budget that sits upstream of the RewardsManager and recurring agreements.',
    deps: [
      { to: 'L2GraphToken', label: 'mints issuance' },
      { to: 'RewardsManager', label: 'allocates issuance to' },
      { to: 'DirectAllocation', label: 'allocates issuance to' },
      { to: 'RecurringAgreementManager', label: 'allocates issuance to' },
    ],
  },
  {
    id: 'DirectAllocation',
    name: 'DirectAllocation',
    layer: 'issuance',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('issuance/allocate/IIssuanceTarget'), ifaceAbi('issuance/allocate/ISendTokens')],
    implements: ['IIssuanceTarget', 'ISendTokens'],
    desc: 'A minimal issuance target that simply receives minted GRT from the IssuanceAllocator and lets an authorized account forward it onward. It is the simplest possible recipient in the issuance system, used for budgets that are managed off-chain or by governance.',
    deps: [{ to: 'L2GraphToken', label: 'receives / sends GRT' }],
  },
  {
    id: 'RecurringAgreementManager',
    name: 'RecurringAgreementManager',
    layer: 'issuance',
    chain: 'L2',
    core: true,
    abis: [
      ifaceAbi('issuance/agreement/IRecurringAgreements'),
      ifaceAbi('issuance/agreement/IRecurringAgreementManagement'),
      ifaceAbi('issuance/agreement/IRecurringEscrowManagement'),
      ifaceAbi('issuance/eligibility/IProviderEligibility'),
      ifaceAbi('issuance/eligibility/IProviderEligibilityManagement'),
      ifaceAbi('horizon/IAgreementOwner'),
      ifaceAbi('issuance/allocate/IIssuanceTarget'),
    ],
    implements: [
      'IRecurringAgreements',
      'IRecurringAgreementManagement',
      'IRecurringEscrowManagement',
      'IProviderEligibility',
      'IAgreementOwner',
      'IIssuanceTarget',
    ],
    desc: 'Funds recurring collection agreements out of issuance instead of payer deposits. As an issuance target it receives GRT from the IssuanceAllocator, parks it in the Payments Escrow, and owns the agreements that the RecurringCollector draws against, gating collection on provider eligibility. This is how the protocol can pay indexers for indexing on an ongoing, issuance-funded basis.',
    deps: [
      { to: 'IssuanceAllocator', label: 'receives issuance from' },
      { to: 'RecurringCollector', label: 'owns agreements on' },
      { to: 'PaymentsEscrow', label: 'funds escrow' },
      { to: 'L2GraphToken', label: 'holds GRT' },
    ],
  },
  {
    id: 'RecurringAgreementHelper',
    name: 'RecurringAgreementHelper',
    layer: 'issuance',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('issuance/agreement/IRecurringAgreementHelper')],
    implements: ['IRecurringAgreementHelper'],
    desc: 'A stateless, permissionless convenience wrapper around the RecurringAgreementManager that bundles common multi-step calls into one. It holds no funds and no privileged role; it exists purely to make integrating with agreements easier.',
    deps: [{ to: 'RecurringAgreementManager', label: 'convenience calls into' }],
  },
  {
    id: 'RewardsEligibilityOracle',
    name: 'RewardsEligibilityOracle',
    layer: 'issuance',
    chain: 'L2',
    core: true,
    abis: [
      ifaceAbi('issuance/eligibility/IProviderEligibility'),
      ifaceAbi('issuance/eligibility/IRewardsEligibilityAdministration'),
      ifaceAbi('issuance/eligibility/IRewardsEligibilityMaintenance'),
      ifaceAbi('issuance/eligibility/IRewardsEligibilityReporting'),
      ifaceAbi('issuance/eligibility/IRewardsEligibilityStatus'),
      ifaceAbi('issuance/eligibility/IRewardsEligibilityEvents'),
    ],
    implements: [
      'IProviderEligibility',
      'IRewardsEligibilityAdministration',
      'IRewardsEligibilityReporting',
      'IRewardsEligibilityStatus',
    ],
    desc: 'Lets authorized off-chain oracles mark indexers as eligible (or not) to receive rewards, with an expiry window. The RewardsManager queries it before paying out, so the protocol can withhold rewards from indexers failing service-quality checks. Several instances are deployed on testnet (A, B and a mock).',
    deps: [],
  },
  {
    id: 'RewardsEligibilityHelper',
    name: 'RewardsEligibilityHelper',
    layer: 'issuance',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('issuance/eligibility/IRewardsEligibilityHelper')],
    implements: ['IRewardsEligibilityHelper'],
    desc: 'A stateless, permissionless convenience wrapper around the RewardsEligibilityOracle that bundles common oracle calls. It holds no state of its own.',
    deps: [{ to: 'RewardsEligibilityOracle', label: 'convenience calls into' }],
  },

  // ----- Curation & Discovery -----
  {
    id: 'Curation',
    name: 'L2Curation',
    layer: 'curation',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/l2/curation/IL2Curation'), ifaceAbi('contracts/curation/ICuration')],
    implements: ['IL2Curation', 'ICuration'],
    desc: 'Curators deposit GRT to "signal" on the subgraph deployments they think indexers should serve, receiving curation shares in return. The amount of signal on a subgraph steers how many indexing rewards it earns, and curators take a small cut of the query fees that flow through it.',
    deps: [
      { to: 'GraphCurationToken', label: 'mints signal shares' },
      { to: 'L2GraphToken', label: 'holds curation reserves' },
    ],
  },
  {
    id: 'GraphCurationToken',
    name: 'GraphCurationToken',
    layer: 'curation',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('contracts/curation/IGraphCurationToken')],
    implements: ['IGraphCurationToken', 'ERC20'],
    desc: 'The ERC-20 share token minted by Curation to represent a curator\'s position on a single subgraph deployment. One token contract is deployed per curation pool; burning shares returns the underlying GRT.',
    deps: [],
  },
  {
    id: 'L2GNS',
    name: 'L2GNS',
    layer: 'curation',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/l2/discovery/IL2GNS'), ifaceAbi('contracts/discovery/IGNS')],
    implements: ['IL2GNS', 'IGNS'],
    desc: 'The Graph Name System: the human-facing registry of "subgraphs" that developers publish and version. Each published subgraph is an NFT whose owner can point it at different underlying deployments. It also receives subgraphs bridged from L1 and auto-migrates their curation.',
    deps: [
      { to: 'SubgraphNFT', label: 'mints ownership NFTs' },
      { to: 'Curation', label: 'curates deployments' },
      { to: 'L2GraphToken', label: 'handles signal GRT' },
    ],
  },
  {
    id: 'SubgraphNFT',
    name: 'SubgraphNFT',
    layer: 'curation',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('contracts/discovery/ISubgraphNFT')],
    implements: ['ISubgraphNFT', 'ERC721'],
    desc: 'The ERC-721 token that represents ownership of a published subgraph in the GNS. Holding the NFT is what lets an account re-point or deprecate that subgraph.',
    deps: [{ to: 'SubgraphNFTDescriptor', label: 'renders token metadata' }],
  },
  {
    id: 'SubgraphNFTDescriptor',
    name: 'SubgraphNFTDescriptor',
    layer: 'curation',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('contracts/discovery/ISubgraphNFTDescriptor')],
    implements: ['ISubgraphNFTDescriptor'],
    desc: 'A pure helper that builds the on-chain metadata (tokenURI) for a SubgraphNFT. It has no state and only produces display data.',
    deps: [],
  },
  {
    id: 'ServiceRegistry',
    name: 'ServiceRegistry',
    layer: 'curation',
    chain: 'L2',
    core: false,
    legacy: true,
    abis: [ifaceAbi('contracts/discovery/IServiceRegistry')],
    implements: ['IServiceRegistry'],
    desc: 'A legacy directory where indexers published the public URL of their query endpoint so gateways could find them. Largely superseded by indexer registration in the Subgraph Service, but still deployed.',
    deps: [],
  },
  {
    id: 'EthereumDIDRegistry',
    name: 'EthereumDIDRegistry',
    layer: 'curation',
    chain: 'L2',
    core: false,
    legacy: true,
    abis: [ifaceAbi('contracts/discovery/erc1056/IEthereumDIDRegistry')],
    implements: ['IEthereumDIDRegistry (ERC-1056)'],
    desc: 'A standard ERC-1056 identity registry used to attach off-chain metadata (such as an indexer\'s profile) to an Ethereum address. Peripheral to the core economic flows.',
    deps: [],
  },

  // ----- Governance -----
  {
    id: 'Controller',
    name: 'Controller',
    layer: 'governance',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/governance/IController')],
    implements: ['IController', 'IManaged'],
    desc: 'The protocol\'s phone book and master switch. Every managed contract looks up its peers by name through the Controller, and it holds the governor address plus a global pause. Change an address here and the whole protocol re-wires to the new contract.',
    deps: [],
  },
  {
    id: 'GraphProxyAdmin',
    name: 'GraphProxyAdmin',
    layer: 'governance',
    chain: 'L2',
    core: false,
    abis: [ifaceAbi('contracts/upgrades/IGraphProxyAdmin')],
    implements: ['IGraphProxyAdmin'],
    desc: 'The owner of the upgradeable proxies. Governance calls it to point a proxy at a new implementation, which is how almost every contract in the protocol gets upgraded.',
    deps: [],
  },
  {
    id: 'EpochManager',
    name: 'EpochManager',
    layer: 'governance',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/epochs/IEpochManager')],
    implements: ['IEpochManager'],
    desc: 'Chops time into fixed-length "epochs" measured in blocks. Allocations and other time-bounded protocol actions reference epochs so that everyone agrees on when one period ends and the next begins.',
    deps: [],
  },
  {
    id: 'SubgraphAvailabilityManager',
    name: 'SubgraphAvailabilityManager',
    layer: 'governance',
    chain: 'L2',
    core: false,
    abis: [implAbi('rewards/SubgraphAvailabilityManager')],
    implements: ['(no published interface)'],
    desc: 'A multi-oracle voting contract that decides which subgraphs are allowed to earn rewards. A quorum of oracles must agree to deny a subgraph, and the RewardsManager reads its verdict before paying out — a safety valve against rewarding harmful content.',
    deps: [{ to: 'RewardsManager', label: 'sets reward denylist' }],
  },

  // ----- Bridge -----
  {
    id: 'L2GraphTokenGateway',
    name: 'L2GraphTokenGateway',
    layer: 'bridge',
    chain: 'L2',
    core: true,
    abis: [ifaceAbi('contracts/l2/gateway/IL2GraphTokenGateway')],
    implements: ['IL2GraphTokenGateway', 'ITokenGateway'],
    desc: 'The L2 end of the Ethereum↔Arbitrum GRT bridge. When GRT arrives from L1 it mints the matching amount here; when users bridge back it burns and signals L1. It can also carry a "callhook" so bridged tokens land directly in a contract like the GNS.',
    deps: [{ to: 'L2GraphToken', label: 'mints / burns bridged GRT' }],
  },
  {
    id: 'L1GraphTokenGateway',
    name: 'L1GraphTokenGateway',
    layer: 'bridge',
    chain: 'L1',
    core: false,
    abis: [implAbi('gateway/L1GraphTokenGateway')],
    implements: ['ITokenGateway', 'IGraphTokenGateway'],
    desc: 'The Ethereum (L1) end of the GRT bridge. It escrows GRT in the BridgeEscrow and sends a message to Arbitrum to mint the matching tokens on L2, and releases escrow when tokens come back.',
    deps: [
      { to: 'BridgeEscrow', label: 'escrows bridged GRT' },
      { to: 'GraphToken', label: 'moves L1 GRT' },
    ],
  },
  {
    id: 'BridgeEscrow',
    name: 'BridgeEscrow',
    layer: 'bridge',
    chain: 'L1',
    core: false,
    abis: [implAbi('gateway/BridgeEscrow')],
    implements: ['(simple escrow)'],
    desc: 'A vault on L1 that simply holds the GRT backing every token bridged to L2. The L1 gateway is approved to move funds in and out as users bridge across.',
    deps: [],
  },

  // ----- Legacy & Periphery -----
  {
    id: 'GraphToken',
    name: 'GraphToken (L1 GRT)',
    layer: 'legacy',
    chain: 'L1',
    core: false,
    abis: [ifaceAbi('contracts/token/IGraphToken')],
    implements: ['IGraphToken', 'ERC20'],
    desc: 'The original GRT ERC-20 on Ethereum mainnet. It is the canonical supply that the L1 gateway escrows when bridging to L2, where L2GraphToken mirrors it.',
    deps: [],
  },
  {
    id: 'L2Staking',
    name: 'L2Staking (legacy)',
    layer: 'legacy',
    chain: 'L2',
    core: false,
    legacy: true,
    abis: [implAbi('l2/staking/L2Staking'), implAbi('staking/StakingExtension')],
    implements: ['IL2Staking', 'IStaking', 'IStakingExtension'],
    desc: 'The pre-Horizon staking contract, where indexers allocated stake directly to subgraphs and earned rewards and query fees. On this branch its proxy has been upgraded to HorizonStaking, so this ABI is the legacy surface of the same address that the migration is moving away from.',
    deps: [
      { to: 'L2GraphToken', label: 'held staked GRT' },
      { to: 'RewardsManager', label: 'claimed rewards' },
    ],
  },
  {
    id: 'AllocationExchange',
    name: 'AllocationExchange',
    layer: 'legacy',
    chain: 'L2',
    core: false,
    legacy: true,
    abis: [implAbi('payments/AllocationExchange')],
    implements: ['(voucher redeemer)'],
    desc: 'A legacy helper that held query-fee funds and let indexers redeem them against vouchers signed by an authority, settling into the old Staking contract. Part of the pre-Horizon query-fee path.',
    deps: [{ to: 'L2Staking', label: 'settled query fees into' }],
  },
]

// ---------------------------------------------------------------------------
// Build the model.
// ---------------------------------------------------------------------------
const docIndex = buildDocIndex()
const sourceIndex = buildSourceIndex()

// Keep only the doc fields that carry content, so data.js stays lean.
function cleanDoc(d) {
  if (!d) return null
  const out = {}
  if (d.notice) out.notice = d.notice
  if (d.details) out.details = d.details
  if (d.params && Object.keys(d.params).length) out.params = d.params
  if (d.returns && Object.keys(d.returns).length) out.returns = d.returns
  return Object.keys(out).length ? out : null
}

const typeToNode = buildTypeToNode(MANIFEST)
const nodes = []
let docFns = 0
let totalFns = 0
let fnsWithEmits = 0
let fnsWithCalls = 0
for (const m of MANIFEST) {
  const nodeDoc = resolveNodeDoc(docIndex, m)
  const { roles, access } = resolveNodeRoles(sourceIndex, m)
  const seenFn = new Set()
  const seenEv = new Set()
  const reads = []
  const writes = []
  const events = []
  for (const abiPath of m.abis) {
    for (const item of loadAbi(abiPath)) {
      if (item.type === 'function') {
        const sig = fnSignature(item)
        if (seenFn.has(sig)) continue
        seenFn.add(sig)
        const doc = cleanDoc(nodeDoc.methods[sig])
        const acc = access[item.name]
        const entry = {
          name: item.name,
          sig,
          inputs: (item.inputs || []).map((i) => ({ name: i.name || '', type: typeStr(i) })),
          outputs: (item.outputs || []).map((o) => ({ name: o.name || '', type: typeStr(o) })),
          mut: item.stateMutability,
        }
        if (doc) entry.doc = doc
        if (acc && (acc.roles.length || acc.mods.length)) entry.access = acc
        totalFns++
        if (doc && doc.notice) docFns++
        if (item.stateMutability === 'view' || item.stateMutability === 'pure') reads.push(entry)
        else writes.push(entry)
      } else if (item.type === 'event') {
        const sig = fnSignature(item)
        if (seenEv.has(sig)) continue
        seenEv.add(sig)
        const doc = cleanDoc(nodeDoc.events[sig])
        const entry = {
          name: item.name,
          sig,
          inputs: (item.inputs || []).map((i) => ({ name: i.name || '', type: typeStr(i), indexed: !!i.indexed })),
        }
        if (doc) entry.doc = doc
        events.push(entry)
      }
    }
  }
  // Attach the events each write can emit and the contracts it calls, parsed
  // from source so a simulated transaction reflects what that function does.
  const maps = nodeBehaviorMaps(sourceIndex, m)
  if (maps) {
    const depTargets = new Set((m.deps || []).map((d) => d.to))
    const dispEvents = new Set(events.map((e) => e.name))
    for (const w of writes) {
      const b = fnBehavior(w.name, maps.bodies, maps.names, maps.typeOf, typeToNode, depTargets, dispEvents)
      if (b.emits.length) { w.emits = b.emits; fnsWithEmits++ }
      if (b.calls.length) { w.calls = b.calls; fnsWithCalls++ }
    }
  }
  reads.sort((a, b) => a.name.localeCompare(b.name))
  writes.sort((a, b) => a.name.localeCompare(b.name))
  events.sort((a, b) => a.name.localeCompare(b.name))
  // Surface roles the contract declares or gates behind; drop bare noise.
  const usedRoles = roles
    .filter((r) => (r.gates && r.gates.length) || r.notice || r.dev)
    .map((r) => ({ name: r.name, notice: r.notice || '', dev: r.dev || '', admin: r.admin || '', gates: r.gates || [] }))
  const contractDoc =
    nodeDoc.contract.title || nodeDoc.contract.notice
      ? { title: nodeDoc.contract.title || '', notice: nodeDoc.contract.notice || '' }
      : null
  nodes.push({
    id: m.id,
    name: m.name,
    layer: m.layer,
    chain: m.chain,
    core: !!m.core,
    legacy: !!m.legacy,
    address: ADDR[m.id] || null,
    desc: m.desc,
    contractDoc,
    implements: m.implements || [],
    deps: m.deps || [],
    roles: usedRoles,
    reads,
    writes,
    events,
    counts: { reads: reads.length, writes: writes.length, events: events.length },
  })
}

// Edges (deduped, only between known nodes).
const ids = new Set(nodes.map((n) => n.id))
const edges = []
const eseen = new Set()
for (const n of nodes) {
  for (const d of n.deps) {
    if (!ids.has(d.to)) {
      console.error(`  ! edge to unknown node: ${n.id} -> ${d.to}`)
      continue
    }
    const key = `${n.id}->${d.to}`
    if (eseen.has(key)) continue
    eseen.add(key)
    edges.push({ from: n.id, to: d.to, label: d.label, kind: d.kind || 'flow' })
  }
}

const out = {
  meta: {
    branch: 'deployment/testnet/2026-06-09/gip-0088',
    network: 'Arbitrum Sepolia (chain 421614)',
    generated: 'from compiled ABIs in packages/interfaces + packages/contracts',
    note:
      'Read = view/pure functions. Write = state-changing functions. Function and event signatures are extracted verbatim from compiled ABIs; per-function and per-event descriptions are the contracts’ own NatSpec (@notice/@dev/@param/@return) harvested from compiled metadata; roles and access control are parsed from the .sol modifiers; contract descriptions and edges are curated from NatSpec and on-chain wiring (Controller registry, GraphDirectory, Directory, constructor references).',
    layers: LAYERS,
  },
  nodes,
  edges,
}

const totalReads = nodes.reduce((s, n) => s + n.counts.reads, 0)
const totalWrites = nodes.reduce((s, n) => s + n.counts.writes, 0)
const totalEvents = nodes.reduce((s, n) => s + n.counts.events, 0)

const dataLine = 'window.__GRAPH_PROTOCOL__ = ' + JSON.stringify(out) + ';\n'
fs.writeFileSync(path.join(__dirname, 'data.js'), dataLine)

// Also emit a fully self-contained single file (data inlined) so it works on a
// plain double-click with no server, regardless of browser file:// policy.
const tpl = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const inlined = tpl.replace(
  '<script src="data.js"></script>',
  '<script>\n' + dataLine + '</script>',
)
fs.writeFileSync(path.join(__dirname, 'graph-protocol-map.html'), inlined)

const totalRoles = nodes.reduce((s, n) => s + n.roles.length, 0)
console.log(
  `Wrote data.js + graph-protocol-map.html: ${nodes.length} contracts, ${edges.length} edges, ` +
    `${totalReads} read fns, ${totalWrites} write fns, ${totalEvents} events, ${totalRoles} roles.`,
)
console.log(`  NatSpec coverage: ${docFns}/${totalFns} functions documented (${Math.round((docFns / totalFns) * 100)}%).`)
console.log(`  Behavior: ${fnsWithEmits} write fns map to emitted events, ${fnsWithCalls} map to called contracts.`)
