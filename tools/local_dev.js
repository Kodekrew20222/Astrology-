import { spawn } from 'node:child_process'

const children = new Set()

function run(name, command, args) {
  const child = spawn(command, args, {
    env: process.env,
    shell: false,
    stdio: 'inherit',
  })

  children.add(child)

  child.on('exit', (code, signal) => {
    children.delete(child)
    if (signal) {
      return
    }

    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`)
      stopAll()
      process.exit(code)
    }
  })

  return child
}

function stopAll() {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  })
}

process.on('SIGINT', () => {
  stopAll()
  process.exit(130)
})

process.on('SIGTERM', () => {
  stopAll()
  process.exit(143)
})

run('local functions', 'node', ['tools/local_functions_server.js'])
run('vite', 'npx', ['vite', '--host', '127.0.0.1'])
