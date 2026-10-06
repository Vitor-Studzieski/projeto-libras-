import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', env: process.env }),
]

function stop() {
  children.forEach((child) => child.kill('SIGTERM'))
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)

children.forEach((child) => {
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
})
