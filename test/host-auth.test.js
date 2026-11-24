import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import plugin, { admissionFacts, requestRejection } from '../src/host.js'

test('admissionFacts: builds absolute http/https url and preserves headers/socket/method', () => {
  const socket = { encrypted: true }
  const req = {
    method: 'POST',
    url: '/wechat-studio/skills?foo=1',
    headers: { host: '127.0.0.1:8443', cookie: 'dsh=ok' },
    socket,
  }
  const facts = admissionFacts(req)
  assert.equal(facts.method, 'POST')
  assert.equal(facts.url, 'https://127.0.0.1:8443/wechat-studio/skills?foo=1')
  assert.equal(facts.headers, req.headers)
  assert.equal(facts.socket, socket)

  const fallback = admissionFacts({ headers: { host: 'bad host:::' }, url: '/x' })
  assert.equal(fallback.method, 'GET')
  assert.equal(fallback.url, 'http://localhost/')
})

test('requestRejection: supports legacy DSH < 0.2.3 connection.requestRejection', () => {
  let received = null
  const allowCtx = {
    get: name => name === 'connection' ? {
      requestRejection(req) {
        received = req
        return undefined
      },
    } : undefined,
  }
  const req = { headers: { host: '127.0.0.1:3000', cookie: 'sid=1' } }
  assert.equal(requestRejection(allowCtx, req), undefined)
  assert.deepEqual(received, { headers: req.headers })

  const denyCtx = { get: () => ({ requestRejection: () => 401 }) }
  assert.equal(requestRejection(denyCtx, req), 401)

  const throwCtx = { get: () => ({ requestRejection() { throw new Error('boom') } }) }
  assert.equal(requestRejection(throwCtx, req), 403)
})

test('requestRejection: supports DSH 0.2.3+ connection.admit', () => {
  let received = null
  const allowCtx = {
    get: name => name === 'connection' ? {
      admit(facts) {
        received = facts
        return { peer: { principal: { kind: 'owner' } } }
      },
    } : undefined,
  }
  const req = {
    method: 'GET',
    url: '/wechat-studio/skills',
    headers: { host: '127.0.0.1:4173' },
    socket: { encrypted: false },
  }
  assert.equal(requestRejection(allowCtx, req), undefined)
  assert.equal(received.url, 'http://127.0.0.1:4173/wechat-studio/skills')
  assert.equal(received.headers, req.headers)

  const deny401 = { get: () => ({ admit: () => ({ rejection: 401 }) }) }
  assert.equal(requestRejection(deny401, req), 401)

  const deny403 = { get: () => ({ admit: () => ({ rejection: 403 }) }) }
  assert.equal(requestRejection(deny403, req), 403)

  const undefinedAnswer = { get: () => ({ admit: () => undefined }) }
  assert.equal(requestRejection(undefinedAnswer, req), 403)

  const throwCtx = {
    get: () => ({
      admit() {
        throw new Error('cannot get property "connection.authentication" without inject')
      },
    }),
  }
  assert.equal(requestRejection(throwCtx, req), 403)
})

test('requestRejection: fails closed when connection service is missing or has no gate', () => {
  assert.equal(requestRejection({ get: () => undefined }, { headers: {} }), 403)
  assert.equal(requestRejection({ get: () => ({}) }, { headers: {} }), 403)
})

test('plugin.apply: uses optional connection.authentication scope when available on DSH 0.2.3+', async () => {
  const prevDshHome = process.env.DSH_HOME
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh-wechat-auth-'))
  process.env.DSH_HOME = tempHome
  try {
    let registeredHandler = null
    let injectCallback = null
    let injectedDeps = null
    let disposed = false

    const baseCtx = {
      webServer: {
        register(opts) {
          registeredHandler = opts.handler
          return () => {}
        },
      },
      get(name) {
        if (name === 'connection') {
          return {
            admit() {
              throw new Error('cannot get property "connection.authentication" without inject')
            },
          }
        }
        return undefined
      },
      inject(deps, cb) {
        injectedDeps = deps
        injectCallback = cb
        return { dispose() { disposed = true } }
      },
      effect(fn) {
        return fn()
      },
    }

    plugin.apply(baseCtx)
    assert.deepEqual(injectedDeps, ['connection', 'connection.authentication'])
    assert.equal(typeof registeredHandler, 'function')

    // Before connection.authentication scope activates, baseCtx.connection.admit throws -> 403
    const runRequest = async () => {
      let body = ''
      const res = {
        statusCode: 200,
        writeHead(code) { this.statusCode = code },
        setHeader() {},
        end(chunk) { body = String(chunk ?? '') },
      }
      await registeredHandler({ method: 'GET', url: '/wechat-studio/skills', headers: { host: '127.0.0.1:4173' } }, res)
      return { status: res.statusCode, body: JSON.parse(body) }
    }

    const before = await runRequest()
    assert.equal(before.status, 403)
    assert.equal(before.body.error, '未授权')

    // Activate connection.authentication scope (simulating DSH 0.2.3-alpha.2)
    const loginCtx = {
      get(name) {
        if (name === 'connection') {
          return {
            admit() {
              return { peer: { principal: { kind: 'owner' } } }
            },
          }
        }
        return undefined
      },
    }
    const cleanup = injectCallback(loginCtx)

    const after = await runRequest()
    // Passes auth gate and reaches /skills route (200, not 403 未授权)
    assert.equal(after.status, 200)
    assert.ok(after.body.skills)

    cleanup()
    const afterCleanup = await runRequest()
    assert.equal(afterCleanup.status, 403)
    assert.equal(disposed, false)
  } finally {
    if (prevDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevDshHome
    rmSync(tempHome, { recursive: true, force: true })
  }
})
