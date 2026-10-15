const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load() {
  class Component {
    constructor(props) { this.props = props }
    setState(next) { this.state = { ...this.state, ...next } }
  }
  const React = { Component, createElement: (type, props) => ({ type, props }) }
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '../src/components/app-error-boundary.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    if (id === 'react') return React
    if (id === 'react-native') return {}
    if (id === './ui') return {}
    if (id === '../theme') return {}
    throw new Error(`Unexpected dependency: ${id}`)
  }, console: { warn() {} } })
  return module.exports.AppErrorBoundary
}

test('render failure replaces the broken tree and retry remounts original content without storage access', () => {
  const Boundary = load()
  const child = { screen: 'app' }
  const boundary = new Boundary({ children: child })
  assert.equal(boundary.render(), child)
  boundary.setState(Boundary.getDerivedStateFromError(new Error('render failure')))
  const fallback = boundary.render()
  assert.notEqual(fallback, child)
  assert.equal(typeof fallback.props.onRetry, 'function')
  fallback.props.onRetry()
  assert.equal(boundary.render(), child)
})

test('repeated render failure returns to recovery without retaining an error payload', () => {
  const Boundary = load()
  const boundary = new Boundary({ children: 'app' })
  for (let i = 0; i < 3; i++) {
    boundary.setState(Boundary.getDerivedStateFromError(new Error('private render context')))
    assert.deepEqual(Object.keys(boundary.state), ['hasError'])
    boundary.render().props.onRetry()
    assert.equal(boundary.render(), 'app')
  }
})
